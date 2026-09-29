import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain ESM dev script, no type declarations
import { parseDependsOn, parseVerification, classify } from '../../scripts/harness/select.mjs';

const meta = (depLine: string) => `## Goal\nx\n\n## Metadata\n${depLine}\nSize: S\nArea: x\n`;

describe('parseDependsOn', () => {
    it('returns [] for none', () => {
        expect(parseDependsOn(meta('Depends on: none'))).toEqual([]);
    });

    it('parses one and several issues', () => {
        expect(parseDependsOn(meta('Depends on: #1'))).toEqual([1]);
        expect(parseDependsOn(meta('Depends on: #1, #22'))).toEqual([1, 22]);
    });

    it('returns null without a Metadata section', () => {
        expect(parseDependsOn('## Goal\nDepends on: #1\n')).toBeNull();
    });

    it('returns null for two Depends lines', () => {
        expect(parseDependsOn(meta('Depends on: #1\nDepends on: #2'))).toBeNull();
    });

    it('returns null for a number without #', () => {
        expect(parseDependsOn(meta('Depends on: 165'))).toBeNull();
    });

    it('ignores a Depends on line outside Metadata', () => {
        const body = `## Context\nDepends on: #9\n\n${meta('Depends on: #1')}`;
        expect(parseDependsOn(body)).toEqual([1]);
        // Metadata ends at a --- line; the footer below it is not metadata.
        expect(parseDependsOn(`${meta('Depends on: #1')}\n---\nDepends on: #2\n`)).toEqual([1]);
    });
});

describe('parseVerification', () => {
    it('returns backticked commands in order', () => {
        const body = '## Verification\n- `npm run e2e -- e2e/a.spec.ts`\n- `npx vitest run x` then `npm run build`\n## Out of scope\n- `nope`\n';
        expect(parseVerification(body)).toEqual(['npm run e2e -- e2e/a.spec.ts', 'npx vitest run x', 'npm run build']);
    });
});

describe('classify', () => {
    const issue = (over: Record<string, unknown> = {}) => ({
        state: 'OPEN',
        labels: [{ name: 'agent-ready' }],
        body: meta('Depends on: #1, #2'),
        ...over,
    });
    const closed = { state: 'CLOSED', stateReason: 'COMPLETED' };
    const ctx = (over: Record<string, unknown> = {}) => ({
        subIssueCount: 0,
        openPrForIssue: undefined,
        deps: { 1: closed, 2: closed },
        ...over,
    });

    it('is ready for an open agent-ready issue with closed deps and no PR', () => {
        expect(classify(issue(), ctx())).toEqual({ ready: true });
    });

    it.each([
        ['closed', issue({ state: 'CLOSED' }), ctx()],
        ['epic', issue(), ctx({ subIssueCount: 3 })],
        ['needs-design', issue({ labels: [{ name: 'agent-ready' }, { name: 'needs-design' }] }), ctx()],
        ['blocked (see last comment)', issue({ labels: [{ name: 'agent-ready' }, { name: 'blocked' }] }), ctx()],
        ['not agent-ready', issue({ labels: [] }), ctx()],
        ['no valid Depends on line', issue({ body: '## Goal\nx' }), ctx()],
        ['open PR #7', issue(), ctx({ openPrForIssue: 7 })],
        ['waiting on #1, #2', issue(), ctx({ deps: { 1: { state: 'OPEN' }, 2: { state: 'OPEN' } } })],
        [
            'dependency #2 closed as not planned',
            issue(),
            ctx({ deps: { 1: closed, 2: { state: 'CLOSED', stateReason: 'NOT_PLANNED' } } }),
        ],
    ])('skips with "%s"', (reason, i, c) => {
        expect(classify(i, c)).toEqual({ ready: false, reason });
    });
});
