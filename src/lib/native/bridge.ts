// The native bridge (#1138): widgets, intents, Spotlight, shortcuts, tiles and watch apps
// run outside the web view and can't read PGlite, so the app mirrors a small snapshot for
// them and drains the actions they queue. The schema is bridgeSchema.json; the native
// writers (iOS #1097, Android #1125) only move the bytes.
import { invokeNative } from '@/lib/native';
import { localDateKey } from '@/lib/reminderSchedule';

/** The premium Tauri plugin that writes the snapshot and holds the action queue. */
export const BRIDGE_PLUGIN = 'journal-bridge';
export const BRIDGE_SCHEMA_VERSION = 1;
export const BRIDGE_RECENT_LIMIT = 20;
export const BRIDGE_SNIPPET_LENGTH = 120;

export const BRIDGE_LICENSE_STATES = ['trial', 'licensed', 'expired', 'none'] as const;
export type BridgeLicenseState = (typeof BRIDGE_LICENSE_STATES)[number];

export interface BridgeLicense {
    state: BridgeLicenseState;
    trialEndsAt?: string;
    updatesUntil?: string;
}

/** Until the licence lands (#301), the app has none, so the bridge accepts no actions. */
export const NO_LICENSE: BridgeLicense = { state: 'none' };

export function licenseAllowsActions(license: BridgeLicense): boolean {
    return license.state === 'trial' || license.state === 'licensed';
}

interface SnapshotBase {
    schemaVersion: typeof BRIDGE_SCHEMA_VERSION;
    updatedAt: string;
    /** The user's calendar date `YYYY-MM-DD` in `timeZone` when written. */
    localDate: string;
    timeZone: string;
    license: BridgeLicense;
}

export type BridgeSnapshot = SnapshotBase &
    (
        | {
              redacted: false;
              today: { id: string | null; title: string; exists: boolean };
              recent: { id: string; title: string; snippet: string; modified: string }[];
          }
        | {
              redacted: true;
              today: { id: string | null; exists: boolean };
              recent: { id: string; modified: string }[];
          }
    );

export const BRIDGE_ACTION_TYPES = ['new_note', 'append_today', 'open'] as const;
export type BridgeActionType = (typeof BRIDGE_ACTION_TYPES)[number];

/** One file in the action queue. */
export interface BridgeAction {
    id: string;
    type: BridgeActionType;
    text?: string;
    noteId?: string;
    createdAt: string;
    /** The surface that wrote it: widget, intent, watch, tile, shortcut. */
    source: string;
}

export interface BridgeSnapshotState {
    now: Date;
    timeZone: string;
    /** `notesVisibleOutsideApp()`: false redacts the snapshot. */
    visible: boolean;
    license: BridgeLicense;
    /** Today's daily note, or null until it is written. */
    todayId: string | null;
    /** Newest first. `text` is the note's plain text. */
    recent: { id: string; title: string; text: string; modified: string }[];
}

function snippet(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    if (flat.length <= BRIDGE_SNIPPET_LENGTH) return flat;
    // Room for the ellipsis, without leaving half of a surrogate pair.
    const cut = flat.slice(0, BRIDGE_SNIPPET_LENGTH - 1).replace(/[\uD800-\uDBFF]$/, '');
    return `${cut.trimEnd()}…`;
}

/** The snapshot the native surfaces read. Redacted: ids and counts only, no titles or snippets. */
export function buildBridgeSnapshot(state: BridgeSnapshotState): BridgeSnapshot {
    const localDate = localDateKey(state.now, state.timeZone);
    const base: SnapshotBase = {
        schemaVersion: BRIDGE_SCHEMA_VERSION,
        updatedAt: state.now.toISOString(),
        localDate,
        timeZone: state.timeZone,
        license: state.license,
    };
    const recent = state.recent.slice(0, BRIDGE_RECENT_LIMIT);
    const exists = state.todayId !== null;
    if (!state.visible) {
        return {
            ...base,
            redacted: true,
            today: { id: state.todayId, exists },
            recent: recent.map(({ id, modified }) => ({ id, modified })),
        };
    }
    return {
        ...base,
        redacted: false,
        // The daily note's title is its date (useDailyNote's todayTitle).
        today: { id: state.todayId, title: localDate, exists },
        recent: recent.map(({ id, title, text, modified }) => ({ id, title, snippet: snippet(text), modified })),
    };
}

export type BridgePurgeReason = 'hidden' | 'sign-out' | 'account-switch';

/**
 * The `bridge:purge` event: the native bridge drops everything it exposed (snapshot,
 * Spotlight index, Jump List, dynamic shortcuts, watch caches) at once. Sent when notes
 * stop being visible outside the app, on sign-out and on an account switch. Does nothing
 * without the bridge plugin (the web, the public build).
 */
export async function emitBridgePurge(reason: BridgePurgeReason): Promise<void> {
    try {
        await invokeNative(BRIDGE_PLUGIN, 'bridge_wipe', { reason });
    } catch (err) {
        console.warn('[bridge] Purge failed:', err);
    }
}

const BRIDGE_IDENTITY_KEY = 'journal-bridge-identity';

/** Purges once when the app runs as a different identity than the one the bridge last wrote for. */
export async function checkBridgeIdentity(identity: string): Promise<void> {
    const last = localStorage.getItem(BRIDGE_IDENTITY_KEY);
    localStorage.setItem(BRIDGE_IDENTITY_KEY, identity);
    if (last !== null && last !== identity) await emitBridgePurge('account-switch');
}

export const SHOW_NOTES_OUTSIDE_APP_KEY = 'journal-show-notes-outside-app';
const visibilityListeners = new Set<() => void>();

/** Settings -> Security "Show notes outside the app": on unless turned off. Device-local. */
export function getShowNotesOutsideApp(): boolean {
    return localStorage.getItem(SHOW_NOTES_OUTSIDE_APP_KEY) !== 'false';
}

/**
 * Whether note titles and snippets may appear outside the app. The only thing that decides
 * redaction: `buildBridgeSnapshot` takes its value. #1017 adds the app lock and encryption
 * (false while either is on, unless the toggle is on).
 */
export function notesVisibleOutsideApp(): boolean {
    return getShowNotesOutsideApp();
}

export function subscribeNotesVisibility(listener: () => void): () => void {
    visibilityListeners.add(listener);
    return () => visibilityListeners.delete(listener);
}

/** Turning it off hides the notes, so the bridge purges at once. */
export function setShowNotesOutsideApp(on: boolean): void {
    const before = notesVisibleOutsideApp();
    localStorage.setItem(SHOW_NOTES_OUTSIDE_APP_KEY, String(on));
    visibilityListeners.forEach((listener) => listener());
    if (before && !notesVisibleOutsideApp()) void emitBridgePurge('hidden');
}
