// @vitest-environment happy-dom
/**
 * #1467: a database that stops answering (a lost worker message after WebKit restarted its
 * Networking process) is noticed by the heartbeat, written down, and recovered by a reload,
 * instead of every note and folder silently failing to open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { PGliteInterface, Transaction } from '@electric-sql/pglite';

const { toastError, reloadPage, invoke, native } = vi.hoisted(() => ({
  toastError: vi.fn(),
  reloadPage: vi.fn(),
  invoke: vi.fn(async () => undefined),
  native: { app: false },
}));
vi.mock('sonner', () => ({ toast: { error: toastError } }));
vi.mock('@/lib/reloadReason', () => ({ reloadPage }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/lib/db/databaseKey', () => ({ inTauriApp: () => native.app, usesEncryptedDatabase: () => false }));
// The open note's writes reach a database that never answers.
vi.mock('@/lib/db', () => ({
  saveDocumentUpdate: () => new Promise(() => {}),
  getDocumentUpdates: async () => [],
  replaceDocumentUpdates: async () => {},
  getSearchIndexEntry: async () => null,
}));

type Health = typeof import('@/lib/db/dbHealth');
let health: Health;

const never = <T>() => new Promise<T>(() => {});

/** A database whose calls answer as `answer` says; `SELECT 1` with `ping`. */
function fakeDatabase(ping: () => Promise<unknown> = never) {
  const db = {
    query: vi.fn((sql: string) => (sql === 'SELECT 1' ? ping() : never())),
    exec: vi.fn(() => never()),
    transaction: vi.fn(() => never()),
  };
  return db as typeof db & PGliteInterface;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

const lastLine = () => JSON.parse(localStorage.getItem('journal-db-hang') ?? '{}').line as string | undefined;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout', 'Date'] });
  vi.resetModules();
  toastError.mockReset();
  reloadPage.mockReset();
  invoke.mockClear();
  native.app = false;
  localStorage.clear();
  setVisibility('visible');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('navigator', {
    locks: { query: async () => ({ held: [{ name: 'pglite-election-lock:journal-pglite-pg18' }], pending: [{ name: 'pglite-tab-close:t1' }] }) },
  });
  health = await import('@/lib/db/dbHealth');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('in-flight calls', () => {
  it('records each call while it runs and clears it when it settles or fails', async () => {
    let answer!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    const db = fakeDatabase();
    db.query.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    db.exec.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    health.trackCalls(db);

    const query = db.query("SELECT * FROM search_index WHERE id = 'n1'");
    vi.advanceTimersByTime(1_000);
    const exec = db.exec('VACUUM');
    expect(health.inFlightCalls()).toEqual([
      { kind: 'query', sql: "SELECT * FROM search_index WHERE id = 'n1'", startedAt: expect.any(Number) },
      { kind: 'exec', sql: 'VACUUM', startedAt: expect.any(Number) },
    ]);

    answer({ rows: [] });
    await expect(query).resolves.toEqual({ rows: [] });
    fail(new Error('disk full'));
    await expect(exec).rejects.toThrow('disk full');
    expect(health.inFlightCalls()).toEqual([]);
  });

  it('names SQL without its literal values, in at most 80 characters', () => {
    expect(health.sqlPrefix("SELECT *\n  FROM notes WHERE title = 'my secret' AND n > 42 AND body = $$x$$")).toBe(
      'SELECT * FROM notes WHERE title = ? AND n > ? AND body = ?',
    );
    expect(health.sqlPrefix(`INSERT INTO t VALUES ('${'a'.repeat(300)}`)).toBe('INSERT INTO t VALUES (?');
    expect(health.sqlPrefix(`SELECT ${'x, '.repeat(100)}`)).toHaveLength(80);
  });
});

describe('heartbeat', () => {
  it('writes the diagnostic and shows the Reload toast when SELECT 1 gets no answer', async () => {
    const db = health.trackCalls(fakeDatabase());
    health.watchDatabase(db, { isLeader: () => true });
    db.query("SELECT content FROM document_updates WHERE doc_id = 'n1'").catch(() => {});

    const beat = health.checkDatabase(db);
    await vi.advanceTimersByTimeAsync(5_000);
    await beat;

    const line = lastLine();
    expect(line).toMatch(/^db-unresponsive: SELECT 1 got no answer in 5\.0s/);
    expect(line).toContain('leader yes');
    expect(line).toContain('last ok query never');
    expect(line).toContain('in flight 2: query 5.0s "SELECT content FROM document_updates WHERE doc_id = ?", query 5.0s "SELECT ?"');
    expect(line).toContain('locks held: pglite-election-lock:journal-pglite-pg18; pending: pglite-tab-close:t1');
    expect(line).toContain('storage errors: none');
    expect(line).not.toContain('n1');
    expect(console.error).toHaveBeenCalledWith(`[db-health] ${line}`);

    expect(toastError).toHaveBeenCalledWith('Journal stopped responding. Reload to continue.', expect.objectContaining({ duration: Infinity }));
    const { action } = toastError.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(action.label).toBe('Reload');
    action.onClick();
    await vi.waitFor(() => expect(reloadPage).toHaveBeenCalledWith('db-unresponsive'));
  });

  it('reloads without asking when the page is hidden', async () => {
    const db = health.trackCalls(fakeDatabase());
    const beat = health.checkDatabase(db);
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(5_000);
    await beat;
    expect(toastError).not.toHaveBeenCalled();
    expect(reloadPage).toHaveBeenCalledWith('db-unresponsive');
    expect(lastLine()).toMatch(/^db-unresponsive:/);
  });

  it('rejects the calls waiting on a stuck database, and every later one, instead of hanging', async () => {
    // A lost _releaseQueryLock: every later query waits on a lock nobody releases.
    const db = fakeDatabase();
    const { exec } = db;
    health.trackCalls(db);
    const waiting = db.query('SELECT 2');
    waiting.catch(() => {});
    const beat = health.checkDatabase(db);
    await vi.advanceTimersByTimeAsync(5_000);
    await beat;
    await expect(waiting).rejects.toThrow(health.DatabaseUnresponsiveError);
    await expect(db.exec('SELECT 3')).rejects.toThrow(/stopped responding/);
    expect(exec).not.toHaveBeenCalled();
  });

  it('does not take a long transaction that keeps making progress for a hang', async () => {
    // SELECT 1 waits behind the transaction, which runs a query every 2 s for 14 s.
    let answerPing!: () => void;
    const db = fakeDatabase(() => new Promise((resolve) => { answerPing = () => resolve({ rows: [] }); }));
    const tx = { query: vi.fn(async () => ({ rows: [] })), exec: vi.fn(async () => []) } as unknown as Transaction;
    db.transaction.mockImplementation(((callback: (tx: Transaction) => Promise<unknown>) => callback(tx)) as never);
    health.trackCalls(db);

    let progressing = true;
    const transaction = db.transaction(async (t) => {
      while (progressing) {
        await t.query('UPDATE search_index SET title = $1', ['x']);
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    });
    const beat = health.checkDatabase(db);
    await vi.advanceTimersByTimeAsync(12_000);
    progressing = false;
    await vi.advanceTimersByTimeAsync(2_000);
    await transaction;
    answerPing();
    await beat;
    expect(toastError).not.toHaveBeenCalled();
    expect(lastLine()).toBeUndefined();
  });

  it('does not count a leader change as a hang', async () => {
    const db = health.trackCalls(fakeDatabase(async () => {
      throw new Error('Leader changed, pending operation in indeterminate state');
    }));
    await health.checkDatabase(db);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('counts a failed SELECT 1 as a hang', async () => {
    const db = health.trackCalls(fakeDatabase(async () => {
      throw new Error("PGlite: this tab's connection to the database worker was closed");
    }));
    await health.checkDatabase(db);
    expect(lastLine()).toMatch(/^db-unresponsive: SELECT 1 failed: Error: PGlite: this tab's connection/);
    expect(toastError).toHaveBeenCalled();
  });

  it('runs every 30 s while the page is visible, and when it comes back', async () => {
    const db = fakeDatabase(async () => ({ rows: [] }));
    const { query } = db;
    health.trackCalls(db);
    const stop = health.watchDatabase(db, { isLeader: () => false });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(query).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(query).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(query).toHaveBeenCalledTimes(3);
    stop();
  });
});

describe('recovery', () => {
  it("writes an open note's unsaved edits before the reload", async () => {
    const { PGliteProvider } = await import('@/lib/yjs/provider');
    const { readUnsavedEdits } = await import('@/lib/yjs/unsavedEdits');
    const doc = new Y.Doc();
    const provider = new PGliteProvider('note-1467', doc);
    doc.getText('t').insert(0, 'typed while the database was stuck');

    let copyAtReload: Uint8Array | null = null;
    reloadPage.mockImplementation(async () => {
      copyAtReload = await readUnsavedEdits('note-1467');
    });
    const db = health.trackCalls(fakeDatabase());
    const beat = health.checkDatabase(db);
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(5_000);
    await beat;
    await vi.waitFor(() => expect(copyAtReload).not.toBeNull());

    const restored = new Y.Doc();
    Y.applyUpdate(restored, copyAtReload!);
    expect(restored.getText('t').toString()).toBe('typed while the database was stuck');
    expect(provider).toBeDefined();
  });

  it('sends a fatal storage error from the worker to the same recovery', async () => {
    health.reportStorageError('StaleWriterError: a newer store was written', true);
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(lastLine()).toMatch(/^db-unresponsive: storage failed: StaleWriterError/);
    expect(lastLine()).toContain('storage errors: StaleWriterError: a newer store was written');
  });

  it("appends the line to the native app's db-hangs.log", async () => {
    native.app = true;
    health.reportStorageError('StaleWriterError: a newer store was written', true);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('plugin:journal-diagnostics|append_diagnostic', { line: lastLine() }));
  });

  it("logs the last session's diagnostic once, on the next boot", () => {
    localStorage.setItem('journal-db-hang', JSON.stringify({ line: 'db-unresponsive: x', at: 0, logged: false }));
    health.logLastHang();
    health.logLastHang();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('db-unresponsive: x'));
  });
});
