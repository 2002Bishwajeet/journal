/**
 * Recent sync and push log for Settings → Diagnostics (#800): the last
 * LOG_MAX_ENTRIES console warnings and errors plus the sync events the app logs
 * itself. Lives in memory and is saved to `app_state` so it survives a reload,
 * for a phone where the console is out of reach.
 *
 * A PGlite write costs an IndexedDB flush, so the save is debounced and only
 * triggered by a warning or error; info entries ride along with the next save.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
    at: number;
    level: LogLevel;
    message: string;
}

export const LOG_MAX_ENTRIES = 200;
export const LOG_STATE_KEY = 'diagnosticsLog';
const MAX_MESSAGE_LENGTH = 500;
const PERSIST_DELAY_MS = 5000;

let entries: LogEntry[] = [];
let loaded: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function notify(): void {
    listeners.forEach((listener) => listener());
}

function isEntry(value: unknown): value is LogEntry {
    const entry = value as Partial<LogEntry> | null;
    return (
        !!entry &&
        typeof entry.at === 'number' &&
        typeof entry.message === 'string' &&
        (entry.level === 'info' || entry.level === 'warn' || entry.level === 'error')
    );
}

/** Merges what an earlier session saved in front of this session's entries, once. */
function ensureLoaded(): Promise<void> {
    loaded ??= (async () => {
        try {
            const { getAppState } = await import('@/lib/db/queries/appState');
            const saved = await getAppState<unknown>(LOG_STATE_KEY);
            if (Array.isArray(saved)) {
                entries = [...saved.filter(isEntry), ...entries].slice(-LOG_MAX_ENTRIES);
                notify();
            }
        } catch {
            // No database yet (signed out, still booting): the log starts empty.
        }
    })();
    return loaded;
}

function schedulePersist(): void {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(async () => {
        try {
            await ensureLoaded();
            const { saveAppState } = await import('@/lib/db/queries/appState');
            await saveAppState(LOG_STATE_KEY, entries);
        } catch {
            // Never log from here: it would feed back into the buffer.
        }
    }, PERSIST_DELAY_MS);
}

export function appendLog(level: LogLevel, message: string, at = Date.now()): void {
    entries = [...entries, { at, level, message: message.slice(0, MAX_MESSAGE_LENGTH) }].slice(-LOG_MAX_ENTRIES);
    notify();
    if (level !== 'info') schedulePersist();
}

/** Oldest first. The same array until the log changes, so it works as a store snapshot. */
export function getLogSnapshot(): readonly LogEntry[] {
    return entries;
}

export function subscribeLog(listener: () => void): () => void {
    listeners.add(listener);
    void ensureLoaded();
    return () => {
        listeners.delete(listener);
    };
}

/** The log with the earlier session's saved entries merged in. */
export async function getLogEntries(): Promise<readonly LogEntry[]> {
    await ensureLoaded();
    return entries;
}

export function formatLogArgs(args: unknown[]): string {
    return args
        .map((arg) => {
            if (typeof arg === 'string') return arg;
            if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
            try {
                return JSON.stringify(arg) ?? String(arg);
            } catch {
                return String(arg);
            }
        })
        .join(' ');
}

let consoleCaptured = false;

/** Copies every console.warn and console.error into the log, then calls the original. */
export function installConsoleCapture(): void {
    if (consoleCaptured) return;
    consoleCaptured = true;
    for (const level of ['warn', 'error'] as const) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            original(...args);
            try {
                appendLog(level, formatLogArgs(args));
            } catch {
                // Capturing must never break the caller.
            }
        };
    }
}

/** Tests only: forget everything, including the "already loaded" mark. */
export function resetLogForTests(): void {
    clearTimeout(persistTimer);
    entries = [];
    loaded = null;
    listeners.clear();
}
