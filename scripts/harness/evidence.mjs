#!/usr/bin/env node
// CI screenshot evidence for agent-harness PRs (#1324): agents never run e2e locally, so the
// e2e-evidence job in .github/workflows/e2e.yml publishes what the PR's specs took on purpose.
// It pushes those screenshots to the agent-evidence branch under <issue>/ and keeps one PR
// comment with the gallery.
// Usage: node scripts/harness/evidence.mjs <dir with the downloaded test-results PNGs>
// Env: GH_TOKEN, GITHUB_REPOSITORY, PR_NUMBER (GITHUB_SERVER_URL, GITHUB_RUN_ID for the run link).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const BRANCH = 'agent-evidence';
const MARKER = '<!-- agent-evidence -->';

/** Issue number from the PR body's `Closes #N` line, or null. */
export function closesIssue(body) {
    const m = (body ?? '').match(/\bCloses #(\d+)/i);
    return m ? Number(m[1]) : null;
}

/**
 * Start of the test-results folder name of every test in an e2e spec. Playwright names it
 * `<spec path without .spec.ts, / as ->-<test title>-<project>` and, past 60 characters, keeps
 * only the first 26 of them, so the prefix is cut to that.
 */
export function specPrefix(file) {
    return `${file.replace(/^e2e\//, '').replace(/\.spec\.ts$/, '').replaceAll('/', '-')}-`.slice(0, 26);
}

/**
 * Screenshots the PR's specs took on purpose: PNGs whose test folder belongs to a changed spec,
 * leaving out every folder of a failed attempt (Playwright put a test-failed-N.png in it).
 * `paths` are relative PNG paths; returns them deduplicated by file name, later ones winning.
 */
export function pickShots(paths, changedFiles) {
    const prefixes = changedFiles.filter((f) => /^e2e\/.+\.spec\.ts$/.test(f)).map(specPrefix);
    const failed = new Set(paths.filter((p) => basename(p).startsWith('test-failed-')).map(dirname));
    const byName = new Map();
    for (const p of paths) {
        if (failed.has(dirname(p))) continue;
        if (prefixes.some((prefix) => basename(dirname(p)).startsWith(prefix))) byName.set(basename(p), p);
    }
    return [...byName.values()];
}

/** The PR comment: one row per screenshot, the image inline from the agent-evidence branch. */
export function galleryBody({ repo, issue, names, runUrl }) {
    const rows = names.map((name) => {
        const url = `https://raw.githubusercontent.com/${repo}/${BRANCH}/${issue}/${name}`;
        return `| \`${name}\` | <a href="${url}"><img src="${url}" width="260"></a> |`;
    });
    return [
        MARKER,
        '## E2E screenshots',
        '',
        `Taken in CI by the specs this PR changes, for #${issue}${runUrl ? ` ([run](${runUrl}))` : ''}.`,
        '',
        ...(rows.length ? ['| Screenshot | Image |', '|---|---|', ...rows] : ['No screenshots: no passing spec this PR changes took one.']),
    ].join('\n');
}

/** Git blob SHA of a file, the `sha` the contents API reports for it. */
const blobSha = (buf) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

async function main([dir]) {
    const { GH_TOKEN, GITHUB_REPOSITORY: repo, PR_NUMBER: pr, GITHUB_SERVER_URL, GITHUB_RUN_ID } = process.env;
    // A contents write can 409 while another one lands on the branch: retry once.
    const api = async (path, init = {}, retry = true) => {
        const res = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
            ...init,
            headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json' },
        });
        if (res.status === 409 && retry) return api(path, init, false);
        if (res.status === 404 && (init.method ?? 'GET') === 'GET') return null;
        if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
        return res.json();
    };

    const { body } = await api(`pulls/${pr}`);
    const issue = closesIssue(body);
    if (!issue) {
        console.log('No "Closes #N" in the PR body: nothing to publish.');
        return;
    }
    const files = (await api(`pulls/${pr}/files?per_page=100`)).map((f) => f.filename);
    const pngs = existsSync(dir)
        ? readdirSync(dir, { recursive: true }).filter((p) => p.endsWith('.png'))
        : [];
    const shots = pickShots(pngs, files);

    const comments = await api(`issues/${pr}/comments?per_page=100`);
    const existing = comments.find((c) => c.user.login === 'github-actions[bot]' && c.body.startsWith(MARKER));
    if (!shots.length && !existing) {
        console.log('No screenshots from the specs this PR changes.');
        return;
    }

    for (const shot of shots) {
        const buf = readFileSync(join(dir, shot));
        const path = `contents/${issue}/${basename(shot)}`;
        const sha = (await api(`${path}?ref=${BRANCH}`))?.sha;
        if (sha === blobSha(buf)) continue;
        await api(path, {
            method: 'PUT',
            body: JSON.stringify({ branch: BRANCH, message: `evidence: #${issue} ${basename(shot)}`, content: buf.toString('base64'), sha }),
        });
        console.log(`pushed ${issue}/${basename(shot)}`);
    }

    const runUrl = GITHUB_RUN_ID ? `${GITHUB_SERVER_URL}/${repo}/actions/runs/${GITHUB_RUN_ID}` : undefined;
    const gallery = galleryBody({ repo, issue, names: shots.map((s) => basename(s)), runUrl });
    if (existing) await api(`issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body: gallery }) });
    else await api(`issues/${pr}/comments`, { method: 'POST', body: JSON.stringify({ body: gallery }) });
    console.log(`${existing ? 'updated' : 'posted'} the gallery comment (${shots.length} screenshots)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main(process.argv.slice(2));
