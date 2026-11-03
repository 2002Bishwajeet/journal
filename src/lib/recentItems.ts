import { RECENT_NOTES_KEY, RECENT_SEARCHES_KEY, readJson, writeJson } from '@/lib/storage';

export interface RecentNote {
    docId: string;
    openedAt: number;
}

export const MAX_RECENT_NOTES_STORED = 20;
export const MAX_RECENT_NOTES_SHOWN = 8;
export const MAX_RECENT_SEARCHES = 5;
const CURRENT_VERSION = 1;
/** A recent note adds at most this much to a search score (see applyRecentBoost). */
const BOOST = 0.15;

function load<T>(key: string, isValid: (item: unknown) => item is T): T[] {
    const stored = readJson<{ _v?: number; items?: unknown }>(key);
    if (!stored || stored._v !== CURRENT_VERSION || !Array.isArray(stored.items)) return [];
    return stored.items.filter(isValid);
}

const isRecentNote = (item: unknown): item is RecentNote =>
    typeof item === 'object' && item !== null
    && typeof (item as RecentNote).docId === 'string'
    && typeof (item as RecentNote).openedAt === 'number';

const isString = (item: unknown): item is string => typeof item === 'string';

export const loadRecentNotes = () => load(RECENT_NOTES_KEY, isRecentNote);
export const loadRecentSearches = () => load(RECENT_SEARCHES_KEY, isString);

export const saveRecentNotes = (items: RecentNote[]) =>
    writeJson(RECENT_NOTES_KEY, { _v: CURRENT_VERSION, items });
export const saveRecentSearches = (items: string[]) =>
    writeJson(RECENT_SEARCHES_KEY, { _v: CURRENT_VERSION, items });

export function pushRecentNote(items: RecentNote[], docId: string, openedAt = Date.now()): RecentNote[] {
    return [{ docId, openedAt }, ...items.filter((n) => n.docId !== docId)].slice(0, MAX_RECENT_NOTES_STORED);
}

export function pushRecentSearch(items: string[], query: string): string[] {
    const text = query.trim();
    if (!text) return items;
    const key = text.toLowerCase();
    return [text, ...items.filter((q) => q.toLowerCase() !== key)].slice(0, MAX_RECENT_SEARCHES);
}

export const removeRecentNote = (items: RecentNote[], docId: string) =>
    items.filter((n) => n.docId !== docId);

export const removeRecentSearch = (items: string[], query: string) =>
    items.filter((q) => q !== query);

/** The rows for the recent notes, in stored order. Missing, archived and trashed notes are skipped. */
export function resolveRecentNotes<T extends { docId: string; metadata: { archivalStatus?: number } }>(
    recent: RecentNote[],
    docs: T[],
): T[] {
    const byId = new Map(docs.map((d) => [d.docId, d]));
    const out: T[] = [];
    for (const { docId } of recent) {
        const doc = byId.get(docId);
        if (doc && (doc.metadata.archivalStatus ?? 0) === 0) out.push(doc);
        if (out.length === MAX_RECENT_NOTES_SHOWN) break;
    }
    return out;
}

/**
 * Orders search results by score plus a small boost for recently opened notes.
 * The boost only reorders results that score about the same. The sort is stable.
 */
export function applyRecentBoost<T extends { docId: string; score: number }>(
    results: T[],
    recentIds: string[],
): T[] {
    if (recentIds.length === 0) return results;
    const rankById = new Map<string, number>();
    recentIds.forEach((id, rank) => rankById.set(id, rank));
    const boosted = (r: T) => {
        const rank = rankById.get(r.docId);
        return rank === undefined ? r.score : r.score + BOOST * (1 - rank / MAX_RECENT_NOTES_STORED);
    };
    return [...results].sort((a, b) => boosted(b) - boosted(a));
}
