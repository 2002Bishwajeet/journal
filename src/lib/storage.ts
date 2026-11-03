import { tryJsonParse } from '@/lib/utils';

// Device-local UI state, so it lives in localStorage rather than PGlite: an
// app_state write costs a full IndexedDB flush, and it was queued ahead of the
// note's content read on every tab open and every navigation.
//
// The keys live here rather than in the hooks that own them so logout can clear
// them without importing those hooks — and with them, PGlite.
export const TABS_STORAGE_KEY = 'journal-open-tabs';
export const SESSION_STORAGE_KEY = 'journal-session-state';
export const RECENT_EMOJIS_KEY = 'journal-recent-emojis';
export const RECENT_NOTES_KEY = 'journal-recent-notes';
export const RECENT_SEARCHES_KEY = 'journal-recent-searches';
export const SIDEBAR_COLLAPSE_KEY = 'journal-sidebar-collapse';
export const AI_SETTINGS_KEY = 'journal-ai-settings';
export const LEGACY_WEBLLM_ENABLED_KEY = 'webllm-enabled';
export const SW_RELOAD_COUNT_KEY = 'sw_safety_reload_count';
/** Whether this device lets the browser's AI agent use Journal through WebMCP (#705). */
export const WEBMCP_ENABLED_KEY = 'journal-webmcp-enabled';
/** The identity that already saw the share dialog's Read-only message on this device (#730). */
export const READ_ONLY_SHARE_NOTICE_KEY = 'journal-read-only-share-notice';
/** Per identity: the missing-permission set that identity chose "Not now" for. */
export const PERMISSION_PROMPT_DISMISSED_KEY = 'journal-permission-prompt-dismissed';
/** The identity that sent the owner to the extend-permissions page to fix the journal drive (#870). */
export const SHARE_DRIVE_FIX_ATTEMPT_KEY = 'journal-share-drive-fix-attempt';

/** Reads JSON, yielding null when there is nothing stored or storage throws (private browsing). */
export function readJson<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(key);
        // tryJsonParse yields {} for unparseable data; callers decide what that means.
        return raw ? tryJsonParse<T>(raw) : null;
    } catch {
        return null;
    }
}

export function writeJson(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.error(`Failed to save ${key}:`, error);
    }
}

/** Reads a raw string, yielding null when there is nothing stored or storage throws (private browsing). */
export function readString(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

export function writeString(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        console.error(`Failed to save ${key}:`, error);
    }
}

export function removeKey(key: string): void {
    try {
        localStorage.removeItem(key);
    } catch (error) {
        console.error(`Failed to remove ${key}:`, error);
    }
}
