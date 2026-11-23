import type { PGliteInterface, Transaction } from '@electric-sql/pglite';
import { DB_HANG_KEY, readJson, writeJson } from '@/lib/storage';
import { reloadPage } from '@/lib/reloadReason';
import { inTauriApp } from './databaseKey';

/**
 * Notices a database that stopped answering (#1467). In the macOS app, WebKit restarted its
 * Networking process 20 minutes into a session: a message between the page and the database
 * worker was lost, and every later query waited on it without an error, so notes and folders
 * stopped opening until the app was quit.
 *
 * Every PGlite call is recorded while it runs (trackCalls). While the page is visible, a
 * heartbeat runs `SELECT 1` every 30 s, and when the page comes back, the network comes back
 * or the window gets the focus. One that gets no answer for 5 s, with no other call settling
 * in that time (a long sync transaction is progress, not a hang) and no call ahead of it younger
 * than a minute (one big exec, as an import runs, holds the lock), or that fails, writes a
 * diagnostic line (console, localStorage for the next boot, and the native app's
 * db-hangs.log), rejects every call still waiting and every later one, and asks the user to
 * reload; a hidden page reloads by itself. The unload copies of open notes are written first.
 */

export const HEARTBEAT_EVERY_MS = 30_000;
/** How long the heartbeat waits with no PGlite call settling before the database counts as stuck. */
export const HEARTBEAT_TIMEOUT_MS = 5_000;
/**
 * How long a call the heartbeat queued behind may run before the database counts as stuck: one
 * long query or exec holds the exclusive lock without settling anything, and a lost reply looks
 * the same from here.
 */
export const LONG_CALL_MS = 60_000;
/** The longest the reload waits for the unload copies of open notes. */
const SAVE_BEFORE_RELOAD_MS = 1_500;
/** The in-flight calls and storage errors a diagnostic line names. */
const SHOWN = 5;

export class DatabaseUnresponsiveError extends Error {
  constructor(reason: string) {
    super(`The database stopped responding (${reason}). Reload to continue.`);
    this.name = 'DatabaseUnresponsiveError';
  }
}

type CallKind = 'query' | 'exec' | 'transaction';

export interface InFlightCall {
  kind: CallKind;
  /** The start of the SQL, as given: literals are removed only when a diagnostic names it. */
  sql: string;
  startedAt: number;
}

interface Call extends InFlightCall {
  reject: (error: Error) => void;
}

const inFlight = new Set<Call>();
/** When a PGlite call last settled, inside a transaction too: the database is making progress. */
let lastSettledAt = 0;
let lastSuccessAt = 0;
let stuck: DatabaseUnresponsiveError | null = null;
const storageErrors: string[] = [];
let isLeader = () => false;
let stopHeartbeat: (() => void) | null = null;

/** The calls running now, oldest first. */
export function inFlightCalls(): InFlightCall[] {
  return [...inFlight].map(({ kind, sql, startedAt }) => ({ kind, sql, startedAt })).sort((a, b) => a.startedAt - b.startedAt);
}

function track<R>(kind: CallKind, sql: unknown, run: () => Promise<R>): Promise<R> {
  if (stuck) return Promise.reject(stuck);
  return new Promise<R>((resolve, reject) => {
    const call: Call = { kind, sql: typeof sql === 'string' ? sql.slice(0, 200) : '', startedAt: Date.now(), reject };
    inFlight.add(call);
    const settle = (ok: boolean) => {
      inFlight.delete(call);
      lastSettledAt = Date.now();
      if (ok) lastSuccessAt = lastSettledAt;
    };
    (async () => run())().then(
      (value) => {
        settle(true);
        resolve(value);
      },
      (error: unknown) => {
        settle(false);
        reject(error);
      },
    );
  });
}

/** A transaction's own queries count as progress, so a long one isn't taken for a hang. */
function withProgress(tx: Transaction): Transaction {
  const { query, exec } = tx;
  const progress = () => {
    lastSettledAt = Date.now();
  };
  tx.query = ((...args: Parameters<Transaction['query']>) => query.apply(tx, args).finally(progress)) as Transaction['query'];
  tx.exec = ((...args: Parameters<Transaction['exec']>) => exec.apply(tx, args).finally(progress)) as Transaction['exec'];
  return tx;
}

/** Records every query, exec and transaction on `db` while it runs. Patches `db` and returns it. */
export function trackCalls<T extends PGliteInterface>(db: T): T {
  const { query, exec, transaction } = db;
  db.query = ((...args: Parameters<T['query']>) => track('query', args[0], () => query.apply(db, args))) as T['query'];
  db.exec = ((...args: Parameters<T['exec']>) => track('exec', args[0], () => exec.apply(db, args))) as T['exec'];
  db.transaction = (<R>(callback: (tx: Transaction) => Promise<R>) =>
    track('transaction', '', () => transaction.call(db, (tx) => callback(withProgress(tx))))) as T['transaction'];
  return db;
}

/** The SQL a diagnostic names: no literal values (string, dollar-quoted or numeric), at most 80 characters. */
export function sqlPrefix(sql: string): string {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?(?:\$\1\$|$)/g, '?')
    .replace(/'(?:[^']|'')*(?:'|$)/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The Web Locks held and waited for, by name. `navigator.locks` goes through the same broken process, so it may not answer. */
async function describeLocks(): Promise<string> {
  if (!navigator.locks) return 'locks unavailable';
  const names = (locks: LockInfo[] | undefined) => (locks ?? []).map((lock) => lock.name).join(', ') || 'none';
  const snapshot = await Promise.race([navigator.locks.query().catch(() => null), sleep(1_000).then(() => null)]);
  return snapshot ? `locks held: ${names(snapshot.held)}; pending: ${names(snapshot.pending)}` : 'locks: no answer';
}

async function describe(reason: string, calls: InFlightCall[]): Promise<string> {
  const now = Date.now();
  const shown = calls.slice(0, SHOWN).map((call) => `${call.kind} ${seconds(now - call.startedAt)} "${sqlPrefix(call.sql)}"`);
  return [
    `db-unresponsive: ${reason}`,
    `uptime ${seconds(performance.now())}`,
    `leader ${isLeader() ? 'yes' : 'no'}`,
    `last ok query ${lastSuccessAt ? `${seconds(now - lastSuccessAt)} ago` : 'never'}`,
    `in flight ${calls.length}${shown.length ? `: ${shown.join(', ')}` : ''}`,
    await describeLocks(),
    `storage errors: ${storageErrors.join('; ') || 'none'}`,
  ].join(' | ');
}

/** A line for the console and, in the native app, its db-hangs.log (`append_diagnostic`, diagnostics.rs). */
export function appendDiagnostic(line: string): void {
  console.error(`[db-health] ${line}`);
  if (!inTauriApp()) return;
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('plugin:journal-diagnostics|append_diagnostic', { line }))
    .catch(() => {});
}

/** Logs the diagnostic the last session left (a warning, which Settings → Diagnostics keeps), once. */
export function logLastHang(): void {
  const last = readJson<{ line?: string; at?: number; logged?: boolean }>(DB_HANG_KEY);
  if (!last?.line || last.logged) return;
  console.warn(`[db-health] the database stopped responding at ${new Date(last.at ?? 0).toISOString()}: ${last.line}`);
  writeJson(DB_HANG_KEY, { ...last, logged: true });
}

/** Writes the open notes' unload copies (to localStorage: the database is stuck), then reloads. */
async function reloadNow(): Promise<void> {
  try {
    const { PGliteProvider } = await import('@/lib/yjs/provider');
    await Promise.race([PGliteProvider.saveAllBeforeClose(), sleep(SAVE_BEFORE_RELOAD_MS)]);
  } finally {
    reloadPage('db-unresponsive');
  }
}

async function fail(reason: string): Promise<void> {
  if (stuck) return;
  stuck = new DatabaseUnresponsiveError(reason);
  stopHeartbeat?.();
  const calls = inFlightCalls();
  for (const call of inFlight) call.reject(stuck);
  inFlight.clear();
  const line = await describe(reason, calls);
  appendDiagnostic(line);
  writeJson(DB_HANG_KEY, { line, at: Date.now(), logged: false });
  if (document.visibilityState === 'hidden') {
    await reloadNow();
    return;
  }
  // Imported here: pglite.ts loads this file, and sonner touches the document as it loads.
  const { toast } = await import('sonner');
  toast.error('Journal stopped responding. Reload to continue.', {
    id: 'db-unresponsive',
    duration: Infinity,
    action: { label: 'Reload', onClick: () => void reloadNow() },
  });
}

let beating = false;

/** One heartbeat. Resolves once it has an answer, or the database counts as stuck. */
export async function checkDatabase(db: PGliteInterface): Promise<void> {
  if (beating || stuck) return;
  beating = true;
  const startedAt = Date.now();
  const ahead = [...inFlight];
  const ping = db.query('SELECT 1').then(() => 'ok' as const, (error: unknown) => ({ error }));
  let answer: Awaited<typeof ping> | 'waiting' = 'waiting';
  try {
    while (answer === 'waiting') {
      const running = ahead.filter((call) => inFlight.has(call));
      const busyUntil = running.length ? Math.min(...running.map((call) => call.startedAt)) + LONG_CALL_MS : 0;
      const left = Math.max(Math.max(startedAt, lastSettledAt) + HEARTBEAT_TIMEOUT_MS, busyUntil) - Date.now();
      if (left <= 0) break;
      answer = await Promise.race([ping, sleep(left).then(() => 'waiting' as const)]);
    }
  } finally {
    beating = false;
  }
  if (answer === 'ok') return;
  if (answer === 'waiting') return fail(`SELECT 1 got no answer in ${seconds(Date.now() - startedAt)}`);
  const { error } = answer;
  // Another tab took over as the leader: PGlite rejects what was in flight, and the next query works.
  if (error instanceof Error && error.message.startsWith('Leader changed')) return;
  if (error instanceof DatabaseUnresponsiveError) return;
  return fail(`SELECT 1 failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
}

/**
 * An error from the worker's storage (pglite-cipher's onFatal, workerFs.ts), or an IndexedDB or
 * BroadcastChannel error on the page. A fatal one means writes no longer reach the disk.
 */
export function reportStorageError(text: string, fatal: boolean): void {
  storageErrors.push(text);
  if (storageErrors.length > SHOWN) storageErrors.shift();
  if (fatal) void fail(`storage failed: ${text}`);
}

function onPageError(event: ErrorEvent | PromiseRejectionEvent) {
  const error: unknown = 'reason' in event ? event.reason : (event.error ?? event.message);
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/IndexedDB|IDBDatabase|BroadcastChannel/i.test(text)) reportStorageError(text, false);
}

/** Starts the heartbeat on the open database. Returns its stop. */
export function watchDatabase(db: PGliteInterface, options: { isLeader: () => boolean }): () => void {
  stopHeartbeat?.();
  isLeader = options.isLeader;
  const beat = () => {
    if (document.visibilityState === 'visible') void checkDatabase(db);
  };
  const timer = setInterval(beat, HEARTBEAT_EVERY_MS);
  document.addEventListener('visibilitychange', beat);
  addEventListener('online', beat);
  addEventListener('focus', beat);
  addEventListener('error', onPageError);
  addEventListener('unhandledrejection', onPageError);
  const stop = () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', beat);
    removeEventListener('online', beat);
    removeEventListener('focus', beat);
    removeEventListener('error', onPageError);
    removeEventListener('unhandledrejection', onPageError);
    if (stopHeartbeat === stop) stopHeartbeat = null;
  };
  stopHeartbeat = stop;
  return stop;
}
