import { tryJsonParse } from '@/lib/utils';

// Device-local UI state, so it lives in localStorage rather than PGlite: an
// app_state write costs a full IndexedDB flush, and it was queued ahead of the
// note's content read on every tab open and every navigation.
//
// The keys live here rather than in the hooks that own them so logout can clear
// them without importing those hooks — and with them, PGlite.
export const TABS_STORAGE_KEY = 'journal-open-tabs';
export const SESSION_STORAGE_KEY = 'journal-session-state';
export const SEARCH_CONSENT_KEY = 'journal-search-consent';

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
