/**
 * Settings → Diagnostics (#800): the copied report must not leak secrets or note content.
 */
import { describe, it, expect } from 'vitest';
import { buildReport, explainSyncError, redactText } from '@/lib/diagnostics/report';
import type { PendingSyncItem } from '@/lib/db/queries/diagnostics';
import type { LogEntry } from '@/lib/diagnostics/logBuffer';

// Fixture secrets, each in the shape it takes in real errors and logs.
const SHARED_SECRET = 'c2hhcmVkU2VjcmV0S2V5MTIzNDU2Nzg5MA==';
const AUTH_TOKEN = 'Zm9vYmFyQXV0aFRva2VuMDEyMzQ1Njc4OWFiY2RlZg';
const KEY_HEADER = 'eyJpdiI6IjEyMzQ1Njc4OSIsImtleSI6IkFCQ0RFRjEyMyJ9';
const COOKIE = 'sessionid=abcdef0123456789abcdef0123456789';
const NOTE_TITLE = 'My private diary entry';
const NOTE_BODY = 'Dear diary, today I met the secret agent';

const item = (overrides: Partial<PendingSyncItem> = {}): PendingSyncItem => ({
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'note',
    status: 'retrying',
    isDelete: false,
    title: NOTE_TITLE,
    noteId: '11111111-1111-4111-8111-111111111111',
    folderId: null,
    contentType: null,
    lastSyncedAt: null,
    retryCount: 3,
    nextRetryAt: '2026-01-01T00:05:00.000Z',
    error: {
        message: `Request to https://frodo.dotyou.cloud/api/apps/v1/drive?token=${AUTH_TOKEN} failed with status code 403`,
        code: null,
        operation: 'push',
        since: '2026-01-01T00:00:00.000Z',
    },
    ...overrides,
});

const log: LogEntry[] = [
    { at: 1, level: 'error', message: `[Push] Authorization: Bearer ${AUTH_TOKEN}` },
    { at: 2, level: 'warn', message: `headers {"x-odin-shared-secret":"${SHARED_SECRET}","bx0900":"${AUTH_TOKEN}"}` },
    { at: 3, level: 'error', message: `decrypt failed encryptedKeyHeader=${KEY_HEADER} cookie: ${COOKIE}` },
    { at: 4, level: 'error', message: `Could not save "${NOTE_TITLE}"` },
    { at: 5, level: 'info', message: '[SyncProvider] Sync started' },
];

const status = [
    { label: 'App version', value: 'v1.0.0 (build abc1234)' },
    { label: 'Identity', value: 'frodo.dotyou.cloud' },
];

describe('redactText', () => {
    it.each([
        ['a bearer token', `Authorization: Bearer ${AUTH_TOKEN}`, AUTH_TOKEN],
        ['a shared secret in JSON', `{"sharedSecret":"${SHARED_SECRET}"}`, SHARED_SECRET],
        ['a key header', `encryptedKeyHeader=${KEY_HEADER}`, KEY_HEADER],
        ['a cookie', `Cookie: ${COOKIE}`, COOKIE],
        ['a query-string token', `GET /x?token=${AUTH_TOKEN}&y=1`, AUTH_TOKEN],
        ['a bare token-like run', `failed for ${AUTH_TOKEN} twice`, AUTH_TOKEN],
        ['a data URI', `src=data:image/png;base64,${KEY_HEADER}`, KEY_HEADER],
    ])('removes %s', (_name, text, secret) => {
        const out = redactText(text);
        expect(out).not.toContain(secret);
        expect(out).toContain('[redacted]');
    });

    it('keeps ids, status codes and words that are not secrets', () => {
        const text = 'Note 11111111-1111-4111-8111-111111111111 push failed with status code 403 in DotYouCoreValidationException';
        expect(redactText(text)).toBe(text);
    });

    it('removes the given titles', () => {
        expect(redactText(`Could not save "${NOTE_TITLE}"`, [NOTE_TITLE])).toBe('Could not save "[title]"');
    });

    it('cuts very long text', () => {
        expect(redactText('word '.repeat(500)).length).toBeLessThanOrEqual(301);
    });
});

describe('buildReport', () => {
    const items = [item(), item({ id: '22222222-2222-4222-8222-222222222222', kind: 'folder', title: 'Work', error: null, status: 'pending' })];

    it('contains none of the fixture secrets or note content', () => {
        const report = buildReport({ status, items, log, includeTitles: true });

        for (const secret of [SHARED_SECRET, AUTH_TOKEN, KEY_HEADER, COOKIE, 'sessionid=abcdef']) {
            expect(report).not.toContain(secret);
        }
        expect(report).not.toContain(NOTE_BODY);
    });

    it('leaves note and folder titles out unless the owner turns them on', () => {
        const off = buildReport({ status, items, log, includeTitles: false });
        expect(off).not.toContain(NOTE_TITLE);
        expect(off).not.toContain('Work');
        expect(off).toContain('Could not save "[title]"');

        const on = buildReport({ status, items, log, includeTitles: true });
        expect(on).toContain(`title: ${NOTE_TITLE}`);
    });

    it('reports the status block, every item and only the last 50 log lines', () => {
        const longLog: LogEntry[] = Array.from({ length: 80 }, (_, i) => ({ at: i, level: 'info', message: `line ${i}` }));
        const report = buildReport({ status, items, log: longLog, includeTitles: false, now: Date.parse('2026-01-01T00:00:00Z') });

        expect(report).toContain('Generated: 2026-01-01T00:00:00.000Z');
        expect(report).toContain('Identity: frodo.dotyou.cloud');
        expect(report).toContain('== Pending items (2) ==');
        expect(report).toContain('error (push, HTTP 403)');
        expect(report).toContain('line 79');
        expect(report).toContain('line 30');
        expect(report).not.toContain('line 29');
    });

    it('says so when nothing is pending or logged', () => {
        const report = buildReport({ status, items: [], log: [], includeTitles: false });
        expect(report).toContain('None');
        expect(report).toContain('Empty');
    });
});

describe('explainSyncError', () => {
    const explain = (message: string, operation = 'push') => explainSyncError({ message, code: null, operation });

    it('puts an HTTP status in plain words with its code underneath', () => {
        expect(explain('Request failed with status code 403')).toMatchObject({ code: 'HTTP 403', plain: expect.stringContaining('permission') });
        expect(explain('Request failed with status code 401').plain).toMatch(/sign-in/);
        expect(explain('Request failed with status code 503').plain).toMatch(/Homebase had a problem/);
    });

    it('recognises a connection failure', () => {
        expect(explain('Network Error').plain).toMatch(/Couldn't reach your Homebase/);
    });

    it('prefers a stored error code', () => {
        expect(explainSyncError({ message: 'x', code: 'ERR_CUSTOM', operation: 'pull' }).code).toBe('ERR_CUSTOM');
    });

    it('falls back to the operation', () => {
        expect(explain('weird', 'upload').plain).toMatch(/upload this image/);
        expect(explain('weird', 'pull').plain).toMatch(/download/);
    });
});
