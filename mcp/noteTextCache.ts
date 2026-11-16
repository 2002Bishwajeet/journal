import type { NoteSummary } from '@/lib/agent/tools/read';

/** About 50 MB of text, in characters. */
const MAX_CHARS = 50_000_000;

/**
 * `ReadDeps.getNoteText` over `fetchText`, remembering each note's text until its `modified` changes.
 * The least recently used notes are dropped past `maxChars`. Only for reading: what a write tool edits
 * is never taken from here, as an edit needs the note's live versionTag.
 */
export function createNoteTextCache(
    fetchText: (id: string) => Promise<{ modified: string; text: string } | null>,
    maxChars = MAX_CHARS
): (note: NoteSummary) => Promise<string | null> {
    const cache = new Map<string, { modified: string; text: string }>();
    let chars = 0;

    return async (note) => {
        const hit = cache.get(note.id);
        if (hit?.modified === note.modified) {
            // Last used goes last in the Map's order.
            cache.delete(note.id);
            cache.set(note.id, hit);
            return hit.text;
        }
        const fetched = await fetchText(note.id);
        if (hit) {
            cache.delete(note.id);
            chars -= hit.text.length;
        }
        if (!fetched) return null;
        cache.set(note.id, fetched);
        chars += fetched.text.length;
        for (const [id, entry] of cache) {
            if (chars <= maxChars || id === note.id) break;
            cache.delete(id);
            chars -= entry.text.length;
        }
        return fetched.text;
    };
}
