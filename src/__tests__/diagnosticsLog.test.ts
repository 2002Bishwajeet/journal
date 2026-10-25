/**
 * Settings → Diagnostics (#800): the recent-log ring buffer caps its size, survives a
 * reload through app_state, and copies console warnings and errors.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

import { getAppState } from '@/lib/db/queries';
import {
    appendLog, getLogEntries, getLogSnapshot, installConsoleCapture, formatLogArgs, resetLogForTests,
    LOG_MAX_ENTRIES, LOG_STATE_KEY,
} from '@/lib/diagnostics/logBuffer';

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });

beforeEach(async () => {
    await resetTestDatabase();
    resetLogForTests();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('log ring buffer', () => {
    it('keeps only the newest LOG_MAX_ENTRIES, oldest dropped first', () => {
        for (let i = 0; i < LOG_MAX_ENTRIES + 25; i++) appendLog('info', `line ${i}`, i);

        const log = getLogSnapshot();
        expect(log).toHaveLength(LOG_MAX_ENTRIES);
        expect(log[0].message).toBe('line 25');
        expect(log[log.length - 1].message).toBe(`line ${LOG_MAX_ENTRIES + 24}`);
    });

    it('cuts a very long message', () => {
        appendLog('error', 'x'.repeat(5000));
        expect(getLogSnapshot()[0].message.length).toBeLessThanOrEqual(500);
    });

    it('saves a warning after a delay and brings it back after a reload', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        appendLog('info', 'sync started', 1);
        appendLog('error', 'push failed', 2);

        expect(await getAppState(LOG_STATE_KEY)).toBeNull();
        await vi.advanceTimersByTimeAsync(5000);
        await vi.waitFor(async () => {
            expect(await getAppState(LOG_STATE_KEY)).toHaveLength(2);
        });

        resetLogForTests(); // a new page load: memory is empty
        expect(getLogSnapshot()).toHaveLength(0);
        const restored = await getLogEntries();
        expect(restored.map((e) => e.message)).toEqual(['sync started', 'push failed']);
    });

    it('puts a saved earlier session before this session and still caps the total', async () => {
        await db.query(`INSERT INTO app_state (key, value) VALUES ($1, $2)`, [
            LOG_STATE_KEY,
            JSON.stringify(Array.from({ length: LOG_MAX_ENTRIES }, (_, i) => ({ at: i, level: 'info', message: `old ${i}` }))),
        ]);
        appendLog('warn', 'new one', 999);

        const log = await getLogEntries();
        expect(log).toHaveLength(LOG_MAX_ENTRIES);
        expect(log[log.length - 1].message).toBe('new one');
        expect(log[0].message).toBe('old 1');
    });

    it('ignores saved junk instead of failing', async () => {
        await db.query(`INSERT INTO app_state (key, value) VALUES ($1, $2)`, [
            LOG_STATE_KEY,
            JSON.stringify([{ at: 'x' }, null, { at: 1, level: 'info', message: 'ok' }]),
        ]);
        expect((await getLogEntries()).map((e) => e.message)).toEqual(['ok']);
    });
});

describe('console capture', () => {
    it('copies warn and error into the log and still calls the original', () => {
        const originalWarn = vi.fn();
        const originalError = vi.fn();
        vi.spyOn(console, 'warn').mockImplementation(originalWarn);
        vi.spyOn(console, 'error').mockImplementation(originalError);

        installConsoleCapture();
        console.warn('[Sync] slow', { count: 2 });
        console.error('[Sync] failed', new Error('boom'));

        expect(originalWarn).toHaveBeenCalledWith('[Sync] slow', { count: 2 });
        expect(originalError).toHaveBeenCalled();
        const [warn, error] = getLogSnapshot();
        expect(warn).toMatchObject({ level: 'warn', message: '[Sync] slow [Object]' });
        expect(error).toMatchObject({ level: 'error', message: '[Sync] failed Error: boom' });
    });

    it('formats strings, errors and objects, even a circular one', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        expect(formatLogArgs(['a', new TypeError('b'), { c: 1 }, [1, 2], 3, null])).toBe(
            'a TypeError: b [Object] [Array(2)] 3 null',
        );
        expect(formatLogArgs([circular])).toBe('[Object]');
    });

    it('never puts the contents of a logged file object in the log', () => {
        const dsr = {
            fileId: 'f1',
            fileMetadata: {
                appData: { content: { title: 'Secret diary entry', preview: 'dear diary, today I' } },
            },
            sharedSecretEncryptedKeyHeader: { iv: 'AbCdEf0123456789AbCdEf0123456789', encryptedAesKey: 'zzzz' },
        };
        const message = formatLogArgs(['[Notes] failed to get the content of a dsr', dsr, new Error('HTTP 500')]);
        expect(message).toBe('[Notes] failed to get the content of a dsr [Object] Error: HTTP 500');
    });

    it('retries loading the saved log after the database was not ready', async () => {
        const appState = await import('@/lib/db/queries/appState');
        const spy = vi.spyOn(appState, 'getAppState').mockRejectedValueOnce(new Error('db not ready'));
        appendLog('info', 'this session', 1);
        await getLogEntries();
        await db.query(`INSERT INTO app_state (key, value) VALUES ($1, $2)`, [
            LOG_STATE_KEY,
            JSON.stringify([{ at: 0, level: 'info', message: 'earlier session' }]),
        ]);
        expect((await getLogEntries()).map((e) => e.message)).toEqual(['earlier session', 'this session']);
        spy.mockRestore();
    });
});
