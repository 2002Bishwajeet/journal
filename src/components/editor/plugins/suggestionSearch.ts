/**
 * Shared search for the emoji (`:`) and slash (`/`) suggestion menus.
 *
 * - `createSpacedSuggestionMatch` lets a query contain single spaces
 *   (`:thumbs up`, `/heading 4`) but stops at a double space, a leading space
 *   or the trigger char, so normal prose after a stray `/` or `:` is left alone.
 * - `rankSearch` ranks items: exact > prefix > word-prefix > substring, with
 *   matches on an item's names ahead of matches on its tags/keywords.
 */
import type { SuggestionOptions } from '@tiptap/suggestion';

export interface SearchTerms {
    /** Names / titles / shortcodes. */
    names: string[];
    /** Tags, keywords, descriptions. */
    keywords: string[];
}

const EXACT = 0;
const PREFIX = 1;
const WORD_PREFIX = 2;
const SUBSTRING = 3;
const NONE = 4;

export function normalizeSearchText(text: string): string {
    return text.toLowerCase().replace(/[\s_]+/g, ' ').trim();
}

/** Match tier of a normalized query against normalized terms. */
function matchTier(terms: string[], query: string, words: string[]): number {
    let best = NONE;
    for (const term of terms) {
        if (term === query) return EXACT;
        if (term.startsWith(query)) best = PREFIX;
    }
    if (best !== NONE) return best;
    const termWords = terms.flatMap((t) => t.split(' '));
    if (words.every((w) => termWords.some((tw) => tw.startsWith(w)))) return WORD_PREFIX;
    if (words.every((w) => terms.some((t) => t.includes(w)))) return SUBSTRING;
    return NONE;
}

/**
 * Rank `items` against `query`. A multi-word query matches when every word
 * matches. Ties keep the original order. An empty query returns the items
 * unchanged (up to `limit`).
 */
export function rankSearch<T>(
    items: readonly T[],
    query: string,
    getTerms: (item: T) => SearchTerms,
    limit = Infinity,
): T[] {
    const q = normalizeSearchText(query);
    if (!q) return items.slice(0, limit);
    const words = q.split(' ');

    const scored: { item: T; score: number }[] = [];
    for (const item of items) {
        const { names, keywords } = getTerms(item);
        const nameTier = matchTier(names, q, words);
        const allTier = nameTier === EXACT ? NONE : matchTier([...names, ...keywords], q, words);
        // Score: tier * 2, +1 when only the keywords made it match.
        const score = Math.min(nameTier * 2, allTier * 2 + 1);
        if (score < NONE * 2) scored.push({ item, score });
    }
    // Array.prototype.sort is stable, so ties keep the original order.
    return scored
        .sort((a, b) => a.score - b.score)
        .slice(0, limit)
        .map((s) => s.item);
}

/**
 * Suggestion matcher that allows single spaces in the query. Like the
 * note-link matcher it reads only the text before the cursor, so it never
 * over-runs to the end of the line.
 */
export function createSpacedSuggestionMatch(char: string): SuggestionOptions['findSuggestionMatch'] {
    const c = char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    // Trigger at block start or after whitespace; query = words separated by
    // single spaces, an optional trailing space, and no trigger char.
    const word = `[^\\s${c}]+`;
    const re = new RegExp(`(?:^|\\s)(${c}((?:${word}(?: ${word})* ?)?))$`);
    return ({ $position }) => {
        const textBefore = $position.parent.textBetween(0, $position.parentOffset, undefined, '￼');
        const m = re.exec(textBefore);
        if (!m) return null;
        const text = m[1];
        return {
            range: { from: $position.pos - text.length, to: $position.pos },
            query: m[2],
            text,
        };
    };
}
