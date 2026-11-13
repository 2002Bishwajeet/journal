import type { AdvancedSearchResult, SearchIndexEntry } from '@/types';

export interface TextMatch {
    index: number;
    length: number;
}

const ESCAPE_REGEX = /[.*+?^${}()|[\]\\]/g;

export function escapeRegex(str: string): string {
    ESCAPE_REGEX.lastIndex = 0;
    return str.replace(ESCAPE_REGEX, '\\$&');
}

export function findMatchesInText(
    text: string,
    searchTerm: string,
    caseSensitive: boolean,
    wholeWord: boolean,
): TextMatch[] {
    if (!searchTerm || !text) return [];

    const escaped = escapeRegex(searchTerm);
    const pattern = wholeWord ? `\\b${escaped}\\b` : escaped;
    const flags = caseSensitive ? 'g' : 'gi';

    let regex: RegExp;
    try {
        regex = new RegExp(pattern, flags);
    } catch {
        return [];
    }

    const matches: TextMatch[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
        matches.push({ index: match.index, length: match[0].length });
        if (match.index === regex.lastIndex) regex.lastIndex++;
    }

    return matches;
}

export function nextMatchIndex(current: number, total: number): number {
    if (total === 0) return -1;
    return (current + 1) % total;
}

export function prevMatchIndex(current: number, total: number): number {
    if (total === 0) return -1;
    return (current - 1 + total) % total;
}

/**
 * The text Find in note should look for after a search result is picked, or undefined when the
 * result has no place in the body to go to. Full-text hits are stemmed (`meetings` finds a note that
 * says `meeting`), so the snippet's first <mark> holds the real word, not the query.
 */
export function findTermForResult(
    result: SearchIndexEntry | AdvancedSearchResult,
    query: string,
): string | undefined {
    if (!('matchType' in result)) return undefined;
    const marked = result.contentHighlight?.match(/<mark>(.*?)<\/mark>/s)?.[1]?.trim();
    if (marked) return marked;
    // A substring (LIKE) hit has no snippet to read the word from, and the query is in the note.
    return result.matchType === 'content' && result.contentHighlight ? query.trim() || undefined : undefined;
}
