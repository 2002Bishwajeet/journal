#!/usr/bin/env node
// Picks the agent-ready issues the harness (/implement) can work on now.
// Usage: node scripts/harness/select.mjs <issue#|epic#…> [--json]
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REPO = '2002Bishwajeet/journal';

/** Body of a `## <title>` section, up to the next `## ` heading or a `---` line. */
function section(body, title) {
    const lines = (body ?? '').split(/\r?\n/);
    const start = lines.findIndex((l) => l.trim() === `## ${title}`);
    if (start === -1) return null;
    const out = [];
    for (const line of lines.slice(start + 1)) {
        if (line.startsWith('## ') || line.trim() === '---') break;
        out.push(line);
    }
    return out;
}

/** Issue numbers from the single `Depends on:` line in `## Metadata`; [] for none, null if missing/malformed/duplicated. */
export function parseDependsOn(body) {
    const lines = section(body, 'Metadata');
    if (!lines) return null;
    const dep = lines.filter((l) => l.startsWith('Depends on:'));
    if (dep.length !== 1) return null;
    const m = dep[0].match(/^Depends on: (none|#\d+(, #\d+)*)\s*$/);
    if (!m) return null;
    return m[1] === 'none' ? [] : m[1].split(', ').map((s) => Number(s.slice(1)));
}

/** Backticked commands in `## Verification`, in order. */
export function parseVerification(body) {
    const lines = section(body, 'Verification') ?? [];
    return lines.flatMap((l) => [...l.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
}

export function classify(issue, { subIssueCount, openPrForIssue, deps }) {
    const labels = issue.labels.map((l) => l.name ?? l);
    if (issue.state.toLowerCase() === 'closed') return { ready: false, reason: 'closed' };
    if (subIssueCount > 0) return { ready: false, reason: 'epic' };
    if (labels.includes('needs-design')) return { ready: false, reason: 'needs-design' };
    if (labels.includes('blocked')) return { ready: false, reason: 'blocked (see last comment)' };
    if (!labels.includes('agent-ready')) return { ready: false, reason: 'not agent-ready' };
    const depNums = parseDependsOn(issue.body);
    if (depNums === null) return { ready: false, reason: 'no valid Depends on line' };
    if (openPrForIssue) return { ready: false, reason: `open PR #${openPrForIssue}` };
    const open = depNums.filter((n) => deps[n]?.state.toLowerCase() !== 'closed');
    if (open.length) return { ready: false, reason: `waiting on ${open.map((n) => `#${n}`).join(', ')}` };
    const dropped = depNums.filter((n) => deps[n].stateReason === 'NOT_PLANNED');
    if (dropped.length) {
        return { ready: false, reason: `dependency ${dropped.map((n) => `#${n}`).join(', ')} closed as not planned` };
    }
    return { ready: true };
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const viewIssue = (n) =>
    JSON.parse(gh('issue', 'view', String(n), '-R', REPO, '--json', 'number,title,state,stateReason,labels,body'));
const subIssues = (n) => JSON.parse(gh('api', `repos/${REPO}/issues/${n}/sub_issues`, '--jq', '[.[].number]'));
const openPr = (n) =>
    JSON.parse(
        gh('pr', 'list', '-R', REPO, '--state', 'open', '--search', `Closes #${n} in:body`, '--json', 'number'),
    )[0]?.number;

function main(argv) {
    const json = argv.includes('--json');
    const nums = argv.filter((a) => /^\d+$/.test(a)).map(Number);
    if (!nums.length) {
        console.error('usage: select.mjs <issue#|epic#…> [--json]');
        process.exit(2);
    }
    const ready = [];
    const skipped = [];
    const seen = new Set();
    // One level of epic expansion: an epic argument is reported as skipped and its children are classified.
    const queue = nums.map((n) => ({ n, expand: true }));
    while (queue.length) {
        const { n, expand } = queue.shift();
        if (seen.has(n)) continue;
        seen.add(n);
        const issue = viewIssue(n);
        const subs = subIssues(n);
        if (expand) queue.push(...subs.map((s) => ({ n: s, expand: false })));
        const deps = {};
        for (const d of parseDependsOn(issue.body) ?? []) deps[d] = viewIssue(d);
        const verdict = classify(issue, { subIssueCount: subs.length, openPrForIssue: openPr(n), deps });
        const size = section(issue.body, 'Metadata')?.find((l) => l.startsWith('Size:'))?.slice(5).trim();
        const row = { number: n, title: issue.title, size };
        if (verdict.ready) ready.push(row);
        else skipped.push({ ...row, reason: verdict.reason });
    }
    if (json) {
        console.log(JSON.stringify({ ready, skipped }, null, 2));
        return;
    }
    console.log('issue | title | ready/skip reason');
    for (const r of ready) console.log(`#${r.number} | ${r.title} | ready`);
    for (const s of skipped) console.log(`#${s.number} | ${s.title} | skip: ${s.reason}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
