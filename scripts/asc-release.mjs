#!/usr/bin/env node
// The App Store Connect steps of ios-release.yml (#1304), ported from the owner's
// local asc-version.mjs. The API key comes from the names Tauri's iOS signing reads:
// APPLE_API_KEY (key ID), APPLE_API_ISSUER and APPLE_API_KEY_PATH (the .p8 file).
//
//   versions --commit-count <n> --package-version <x.y.z> [--tag <vX.Y.Z>] [--offline]
//     Prints build_number=<n> and version=<x.y.z> for $GITHUB_OUTPUT. The build number
//     is the commit count, or one above the highest uploaded build when that is higher.
//     The version is the tag's on a release. On main it is package.json's, or the next
//     patch after the last version the App Store released when that is higher: Apple
//     closes a version's build train once the version is released. --offline (dry runs)
//     skips App Store Connect.
//   submit --version <x.y.z> --build <n> --notes-file <file>
//     Waits until App Store Connect has processed the build (VALID), cancels every
//     submission still waiting for review or in review (latest wins), creates or reuses
//     the App Store version, sets its What's New, attaches the build and submits it.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Journal+ on App Store Connect (the public App Store ID). */
const APP_ID = '6833436628';
const BASE = 'https://api.appstoreconnect.apple.com';

/** Version states after approval: the version's build train is closed. */
const RELEASED = new Set([
  'ACCEPTED',
  'PENDING_APPLE_RELEASE',
  'PENDING_DEVELOPER_RELEASE',
  'PROCESSING_FOR_APP_STORE',
  'PROCESSING_FOR_DISTRIBUTION',
  'READY_FOR_DISTRIBUTION',
  'READY_FOR_SALE',
  'REPLACED_WITH_NEW_VERSION',
  'REMOVED_FROM_SALE',
  'DEVELOPER_REMOVED_FROM_SALE',
]);
/** Version states in which a version can still change and take a build. */
const EDITABLE = new Set([
  'PREPARE_FOR_SUBMISSION',
  'READY_FOR_REVIEW',
  'DEVELOPER_REJECTED',
  'REJECTED',
  'METADATA_REJECTED',
  'INVALID_BINARY',
]);
/** Review submissions sent to Apple and not finished: a newer release cancels them. */
const PENDING_REVIEW = new Set(['WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES']);

// appVersionState replaces the deprecated appStoreState; App Store Connect sends both.
const inState = (states, v) => states.has(v.attributes.appVersionState) || states.has(v.attributes.appStoreState);

export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

export function nextPatch(version) {
  const [major, minor = 0, patch = 0] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

/** CFBundleVersion: never below the commit count, always above every uploaded build. */
export const buildNumber = (commitCount, uploaded = []) =>
  Math.max(commitCount, ...uploaded.map(Number).filter(Number.isInteger).map((n) => n + 1));

/** The highest version the App Store has approved, or undefined before the first one. */
export const lastReleased = (versions) =>
  versions
    .filter((v) => inState(RELEASED, v))
    .map((v) => v.attributes.versionString)
    .sort(compareVersions)
    .at(-1);

/** The marketing version (CFBundleShortVersionString) of a release (tag) or main build. */
export function marketingVersion({ tag, packageVersion, released }) {
  if (tag) {
    const version = tag.replace(/^v/, '');
    if (released && compareVersions(version, released) <= 0) {
      throw new Error(`${tag} is not above ${released}, the last version the App Store released`);
    }
    return version;
  }
  if (!released) return packageVersion;
  const floor = nextPatch(released);
  return compareVersions(packageVersion, floor) >= 0 ? packageVersion : floor;
}

export const toCancel = (submissions) => submissions.filter((s) => PENDING_REVIEW.has(s.attributes.state));

/** The version to give the build: the one with this version string, else the editable one. */
export const versionToUse = (versions, versionString) =>
  versions.find((v) => v.attributes.versionString === versionString && inState(EDITABLE, v)) ??
  versions.find((v) => inState(EDITABLE, v));

function token() {
  const { APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_PATH } = process.env;
  if (!APPLE_API_KEY || !APPLE_API_ISSUER || !APPLE_API_KEY_PATH) {
    throw new Error('APPLE_API_KEY, APPLE_API_ISSUER and APPLE_API_KEY_PATH must be set');
  }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'ES256', kid: APPLE_API_KEY, typ: 'JWT' })}.${b64({ iss: APPLE_API_ISSUER, iat, exp: iat + 600, aud: 'appstoreconnect-v1' })}`;
  const signature = createSign('SHA256')
    .update(input)
    .sign({ key: readFileSync(APPLE_API_KEY_PATH), dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${input}.${signature}`;
}

// A new token per request: the submit step can wait longer than a token lives.
async function api(method, path, body) {
  const res = await fetch(path.startsWith('http') ? path : BASE + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const errors = (json.errors ?? []).map((e) => `${e.code}: ${e.detail}`).join(' | ');
    throw new Error(`${method} ${path.split('?')[0]} -> ${res.status} ${errors}`);
  }
  return json;
}

async function all(path) {
  const data = [];
  const included = [];
  for (let url = path; url; ) {
    const page = await api('GET', url);
    data.push(...page.data);
    included.push(...(page.included ?? []));
    url = page.links?.next;
  }
  return { data, included };
}

const log = (...args) => console.error(...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(what, check, minutes) {
  for (const end = Date.now() + minutes * 60_000; Date.now() < end; await sleep(30_000)) {
    if (await check()) return;
  }
  throw new Error(`Timed out after ${minutes} min waiting for ${what}`);
}

const appVersions = async () =>
  (await all(`/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=200`)).data;

async function versions({ commitCount, packageVersion, tag, offline }) {
  let uploaded = [];
  let released;
  if (offline) log('Offline: no App Store Connect lookup');
  else {
    uploaded = (await api('GET', `/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=200`)).data.map(
      (b) => b.attributes.version,
    );
    released = lastReleased(await appVersions());
    log(`Highest uploaded build: ${Math.max(0, ...uploaded.map(Number).filter(Number.isInteger))}`);
    log(`Last version the App Store released: ${released ?? 'none'}`);
  }
  console.log(`build_number=${buildNumber(commitCount, uploaded)}`);
  console.log(`version=${marketingVersion({ tag, packageVersion, released })}`);
}

async function waitForBuild(version, build) {
  const path = `/v1/builds?filter[app]=${APP_ID}&filter[version]=${build}&filter[preReleaseVersion.version]=${version}&filter[preReleaseVersion.platform]=IOS&limit=1`;
  let found;
  await poll(`build ${version} (${build}) to finish processing`, async () => {
    found = (await api('GET', path)).data[0];
    const state = found?.attributes.processingState ?? 'not uploaded yet';
    log(`Build ${version} (${build}): ${state}`);
    if (state === 'FAILED' || state === 'INVALID') throw new Error(`App Store Connect marked build ${build} ${state}`);
    return state === 'VALID';
  }, 90);
  return found;
}

async function cancelPendingReviews() {
  const submissions = () =>
    all(`/v1/reviewSubmissions?filter[app]=${APP_ID}&filter[platform]=IOS&include=appStoreVersionForReview&limit=200`);
  const { data, included } = await submissions();
  const pending = toCancel(data);
  for (const s of pending) {
    const versionId = s.relationships?.appStoreVersionForReview?.data?.id;
    const version = included.find((i) => i.id === versionId)?.attributes.versionString ?? 'unknown version';
    log(`Cancelling review submission ${s.id} of ${version} (${s.attributes.state}): latest wins`);
    await api('PATCH', `/v1/reviewSubmissions/${s.id}`, {
      data: { type: 'reviewSubmissions', id: s.id, attributes: { canceled: true } },
    });
  }
  if (pending.length) {
    await poll('the cancelled submissions', async () => !(await submissions()).data.some((s) => s.attributes.state === 'CANCELING'), 30);
  }
  return (await submissions()).data.find((s) => s.attributes.state === 'READY_FOR_REVIEW');
}

async function submit({ version, build, notesFile }) {
  const whatsNew = readFileSync(notesFile, 'utf8').trim();
  const uploaded = await waitForBuild(version, build);
  const draft = await cancelPendingReviews();

  let appVersion = versionToUse(await appVersions(), version);
  if (!appVersion) {
    log(`Creating App Store version ${version}`);
    appVersion = (
      await api('POST', '/v1/appStoreVersions', {
        data: {
          type: 'appStoreVersions',
          attributes: { platform: 'IOS', versionString: version },
          relationships: { app: { data: { type: 'apps', id: APP_ID } } },
        },
      })
    ).data;
  } else if (appVersion.attributes.versionString !== version) {
    log(`Renaming App Store version ${appVersion.attributes.versionString} to ${version}`);
    await api('PATCH', `/v1/appStoreVersions/${appVersion.id}`, {
      data: { type: 'appStoreVersions', id: appVersion.id, attributes: { versionString: version } },
    });
  } else log(`Reusing App Store version ${version}`);

  for (const loc of (await all(`/v1/appStoreVersions/${appVersion.id}/appStoreVersionLocalizations`)).data) {
    log(`What's New (${loc.attributes.locale}): ${whatsNew.length} characters`);
    await api('PATCH', `/v1/appStoreVersionLocalizations/${loc.id}`, {
      data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { whatsNew } },
    });
  }

  log(`Attaching build ${build} to ${version}`);
  await api('PATCH', `/v1/appStoreVersions/${appVersion.id}/relationships/build`, {
    data: { type: 'builds', id: uploaded.id },
  });

  // App Store Connect keeps one unsent submission per platform: reuse it if there is one.
  const submission =
    draft ??
    (
      await api('POST', '/v1/reviewSubmissions', {
        data: {
          type: 'reviewSubmissions',
          attributes: { platform: 'IOS' },
          relationships: { app: { data: { type: 'apps', id: APP_ID } } },
        },
      })
    ).data;
  const items = (await all(`/v1/reviewSubmissions/${submission.id}/items`)).data;
  if (!items.some((i) => i.relationships?.appStoreVersion?.data?.id === appVersion.id)) {
    await api('POST', '/v1/reviewSubmissionItems', {
      data: {
        type: 'reviewSubmissionItems',
        relationships: {
          reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
          appStoreVersion: { data: { type: 'appStoreVersions', id: appVersion.id } },
        },
      },
    });
  }
  await api('PATCH', `/v1/reviewSubmissions/${submission.id}`, {
    data: { type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } },
  });
  log(`Submitted ${version} (${build}) for App Review: review submission ${submission.id}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      'commit-count': { type: 'string' },
      'package-version': { type: 'string' },
      tag: { type: 'string' },
      offline: { type: 'boolean', default: false },
      version: { type: 'string' },
      build: { type: 'string' },
      'notes-file': { type: 'string' },
    },
  });
  try {
    if (positionals[0] === 'versions') {
      await versions({
        commitCount: Number(values['commit-count']),
        packageVersion: values['package-version'],
        tag: values.tag || undefined,
        offline: values.offline,
      });
    } else if (positionals[0] === 'submit') {
      await submit({ version: values.version, build: values.build, notesFile: values['notes-file'] });
    } else {
      console.error('usage: asc-release.mjs versions|submit [options] (see the header)');
      process.exit(2);
    }
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
