/**
 * #1336: `asc-release.mjs profile` installs the App Store profile the iOS release signs with:
 * it reuses an ACTIVE one with the imported certificate, replaces INVALID ones, or makes one.
 */
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- plain .mjs release script, no types
import { MAC_PROFILE_NAME, PROFILE_NAME, profile } from '../../scripts/asc-release.mjs';

type Call = { method: string; path: string; body?: Record<string, unknown> };

const BUNDLE = { id: 'B1', attributes: { identifier: 'com.biswa.journal' } };
const CERTIFICATES = [
  { id: 'C-old', attributes: { serialNumber: '1111' } },
  { id: 'C1', attributes: { serialNumber: '6A7B' } },
];
const appStoreProfile = (id: string, state: string, certificate: string, bundle = 'B1', name = `Profile ${id}`) => ({
  id,
  attributes: {
    name,
    profileState: state,
    uuid: `uuid-${id}`,
    profileContent: Buffer.from(`profile ${id}`).toString('base64'),
  },
  relationships: {
    bundleId: { data: { type: 'bundleIds', id: bundle } },
    certificates: { data: [{ type: 'certificates', id: certificate }] },
  },
});

let home: string;
let calls: Call[];

function mockAppStoreConnect(profiles: ReturnType<typeof appStoreProfile>[]) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { method: string; body?: string }) => {
      const path = url.replace('https://api.appstoreconnect.apple.com', '');
      calls.push({ method: init.method, path, body: init.body ? JSON.parse(init.body) : undefined });
      const json = (data: unknown) => new Response(JSON.stringify({ data }));
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (init.method === 'POST') {
        const { name } = JSON.parse(init.body!).data.attributes;
        return json(appStoreProfile('NEW', 'ACTIVE', 'C1', 'B1', name));
      }
      if (path.startsWith('/v1/certificates')) return json(CERTIFICATES);
      if (path.startsWith('/v1/bundleIds')) {
        return json([{ id: 'B2', attributes: { identifier: 'com.biswa.journal.widgets' } }, BUNDLE]);
      }
      if (path.startsWith('/v1/profiles')) return json(profiles);
      return new Response('{}', { status: 404 });
    }),
  );
}

const installed = (uuid: string) =>
  ['Library/MobileDevice/Provisioning Profiles', 'Library/Developer/Xcode/UserData/Provisioning Profiles'].map((dir) =>
    readFileSync(join(home, dir, `${uuid}.mobileprovision`), 'utf8'),
  );

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'asc-profile-'));
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  writeFileSync(join(home, 'AuthKey.p8'), privateKey.export({ type: 'pkcs8', format: 'pem' }));
  vi.stubEnv('ASC_KEY_ID', 'KEY');
  vi.stubEnv('APPLE_API_ISSUER', 'ISSUER');
  vi.stubEnv('APPLE_API_KEY_PATH', join(home, 'AuthKey.p8'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

describe('the App Store provisioning profile (#1336)', () => {
  it('reuses an ACTIVE profile of the bundle ID with the imported certificate', async () => {
    mockAppStoreConnect([
      appStoreProfile('P-other-app', 'ACTIVE', 'C1', 'B2'),
      appStoreProfile('P-old-cert', 'ACTIVE', 'C-old'),
      appStoreProfile('P1', 'ACTIVE', 'C1'),
    ]);
    // The keychain's serial can have a leading zero and lower case.
    await expect(profile({ serial: '06a7b', home })).resolves.toEqual({ name: 'Profile P1', uuid: 'uuid-P1' });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(installed('uuid-P1')).toEqual(['profile P1', 'profile P1']);
  });

  it('deletes the INVALID profiles of the bundle ID and makes a new one', async () => {
    mockAppStoreConnect([
      appStoreProfile('P-invalid', 'INVALID', 'C1'),
      appStoreProfile('P-other-app', 'INVALID', 'C1', 'B2'),
      appStoreProfile('P-old-cert', 'ACTIVE', 'C-old'),
    ]);
    await expect(profile({ serial: '6A7B', home })).resolves.toEqual({ name: PROFILE_NAME, uuid: 'uuid-NEW' });
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/v1/profiles/P-invalid']);
    expect(calls.find((c) => c.method === 'POST')).toEqual({
      method: 'POST',
      path: '/v1/profiles',
      body: {
        data: {
          type: 'profiles',
          attributes: { name: PROFILE_NAME, profileType: 'IOS_APP_STORE' },
          relationships: {
            bundleId: { data: { type: 'bundleIds', id: 'B1' } },
            certificates: { data: [{ type: 'certificates', id: 'C1' }] },
          },
        },
      },
    });
    expect(installed('uuid-NEW')).toEqual(['profile NEW', 'profile NEW']);
  });

  it('makes one when there is none, replacing an older one of the same name', async () => {
    mockAppStoreConnect([]);
    await expect(profile({ serial: '6A7B', home })).resolves.toEqual({ name: PROFILE_NAME, uuid: 'uuid-NEW' });
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);

    mockAppStoreConnect([appStoreProfile('P-ours', 'ACTIVE', 'C-old', 'B1', PROFILE_NAME)]);
    await profile({ serial: '6A7B', home });
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/v1/profiles/P-ours']);
  });

  it('stops when the certificate is not the team’s Apple Distribution certificate', async () => {
    mockAppStoreConnect([]);
    await expect(profile({ serial: 'FFFF', home })).rejects.toThrow(/No Apple Distribution certificate .* serial FFFF/);
    expect(calls.some((c) => c.method !== 'GET')).toBe(false);
  });
});

describe('the Developer ID provisioning profile for the Mac app (#1342)', () => {
  it('reuses an ACTIVE MAC_APP_DIRECT profile with the certificate and writes it to --out', async () => {
    mockAppStoreConnect([appStoreProfile('P-old-cert', 'ACTIVE', 'C-old'), appStoreProfile('P1', 'ACTIVE', 'C1')]);
    const out = join(home, 'embedded.provisionprofile');
    await expect(profile({ mac: true, serial: '6A7B', home, out })).resolves.toEqual({ name: 'Profile P1', uuid: 'uuid-P1' });
    expect(readFileSync(out, 'utf8')).toBe('profile P1');
    // Developer ID certificates are DEVELOPER_ID_APPLICATION or _G2: none is filtered out.
    expect(calls.map((c) => c.path.split('&include')[0])).toEqual([
      '/v1/certificates?limit=200',
      '/v1/bundleIds?filter[identifier]=com.biswa.journal&limit=200',
      '/v1/profiles?filter[profileType]=MAC_APP_DIRECT',
    ]);
    // Nothing goes where Xcode looks for iOS profiles.
    expect(() => installed('uuid-P1')).toThrow();
  });

  it('replaces INVALID ones with a new "Journal CI Developer ID" profile', async () => {
    mockAppStoreConnect([appStoreProfile('P-invalid', 'INVALID', 'C1')]);
    const out = join(home, 'embedded.provisionprofile');
    await expect(profile({ mac: true, serial: '6A7B', home, out })).resolves.toEqual({ name: MAC_PROFILE_NAME, uuid: 'uuid-NEW' });
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.path)).toEqual(['/v1/profiles/P-invalid']);
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      data: { attributes: { name: MAC_PROFILE_NAME, profileType: 'MAC_APP_DIRECT' } },
    });
    expect(readFileSync(out, 'utf8')).toBe('profile NEW');
  });

  it('stops when the certificate is not on App Store Connect', async () => {
    mockAppStoreConnect([]);
    const out = join(home, 'embedded.provisionprofile');
    await expect(profile({ mac: true, serial: 'FFFF', home, out })).rejects.toThrow(/serial FFFF: check APPLE_CERTIFICATE/);
    expect(calls.some((c) => c.method !== 'GET')).toBe(false);
  });
});
