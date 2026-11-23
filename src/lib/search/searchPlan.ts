import { COLLABORATIVE_FOLDER_ID } from '@/lib/homebase/config';

/**
 * Turns a search box query into the parts advancedSearch runs (#1225).
 *
 * - `words`: letters, digits and spaces (a hyphen inside a word is fine). Every stage runs.
 * - `syntax`: has a quote or a `-word`. Only full text runs, so `-recipe` excludes and
 *   `"garden recipe"` is a phrase; the substring and typo stages would undo both.
 * - `symbols`: has another character (`a_b`, `100%`, `node.js`). Full text drops those
 *   characters, so only the literal substring stages run.
 */
export interface SearchPlan {
    /** The trimmed query. */
    text: string;
    /** `text` with `\`, `%` and `_` escaped for a LIKE pattern. */
    like: string;
    /** Input for websearch_to_tsquery: the query without `prefix`. */
    head: string;
    /** The last bare word while it is still being typed, matched as a word prefix. */
    prefix: string;
    kind: 'words' | 'syntax' | 'symbols';
}

export function buildSearchPlan(query: string): SearchPlan {
    const text = query.trim();
    const like = text.replace(/[\\%_]/g, '\\$&');
    const kind = /[^\p{L}\p{N}\s"-]/u.test(text) ? 'symbols' : /"|(^|\s)-/.test(text) ? 'syntax' : 'words';
    // A trailing space ends the word; an odd quote count means the last word is inside a phrase.
    const quotes = text.split('"').length - 1;
    const last = /\s$/.test(query) || quotes % 2 === 1 ? null : /(^|\s)([\p{L}\p{N}]+)$/u.exec(text);
    const prefix = last?.[2] ?? '';
    const head = prefix ? text.slice(0, text.length - prefix.length).trim() : text;
    return { text, like, head, prefix, kind };
}

/** A filter in the search box (#1230): `tag:x` or `#x`, `folder:x`, `is:x`, `before:x`, `after:x`. */
export interface SearchToken {
    kind: 'tag' | 'folder' | 'is' | 'before' | 'after';
    /** tag and folder: the name, without quotes; is: `pinned`, `shared` or `public`; before and after: the date as typed. */
    value: string;
    /** before and after: the start of that local date, as an ISO time. */
    at?: string;
    /** Where the token is in the query. */
    start: number;
    end: number;
}

/** The filters as advancedSearch applies them. */
export interface SearchFilters {
    /** Lowercased. A note has all of them. */
    tags?: string[];
    /** A note is in one of these folders. */
    folderIds?: string[];
    pinned?: boolean;
    shared?: boolean;
    public?: boolean;
    /** ISO times: modified on or after `after`, and before `before`. */
    after?: string;
    before?: string;
}

/** The words `after:` takes, and how many days back each one starts. */
const DATE_WORDS = new Map([['today', 0], ['yesterday', 1], ['week', 7], ['month', 30]]);
export const IS_VALUES = ['pinned', 'shared', 'public'];

// A word is a run without spaces, in which a quoted part ("two words") counts as one character.
const WORD = /(?:[^\s"]+|"[^"]*(?:"|$))+/g;
const TOKEN = /^(?:#([^\s"#]+)|(tag|folder|is|before|after):(?:"([^"]+)"|([^\s"]+)))$/i;

/** Local midnight at the start of `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, or, for `after:`, of a word of DATE_WORDS. */
function startOfDate(value: string, kind: 'before' | 'after', now: Date): Date | null {
    const daysBack = kind === 'after' ? DATE_WORDS.get(value.toLowerCase()) : undefined;
    if (daysBack !== undefined) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
    const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value);
    if (!match) return null;
    const [year, month, day] = [Number(match[1]), Number(match[2] ?? 1), Number(match[3] ?? 1)];
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/**
 * Splits the filter tokens off a search box query (#1230). `text` is the query
 * without them, for buildSearchPlan. An unknown `word:`, a known one with a bad
 * value, and a token inside quotes stay in `text`.
 */
export function parseSearchQuery(query: string, now = new Date()): { text: string; tokens: SearchToken[] } {
    const tokens: SearchToken[] = [];
    let text = '';
    let last = 0;
    for (const word of query.matchAll(WORD)) {
        const match = TOKEN.exec(word[0]);
        if (!match) continue;
        const kind = match[1] ? 'tag' : (match[2].toLowerCase() as SearchToken['kind']);
        const value = match[1] ?? match[3] ?? match[4];
        const token: SearchToken = { kind, value, start: word.index, end: word.index + word[0].length };
        if (kind === 'is') {
            if (!IS_VALUES.includes(value.toLowerCase())) continue;
            token.value = value.toLowerCase();
        } else if (kind === 'before' || kind === 'after') {
            const date = startOfDate(value, kind, now);
            if (!date) continue;
            token.at = date.toISOString();
        }
        tokens.push(token);
        text += query.slice(last, token.start);
        last = token.end;
    }
    return { text: text + query.slice(last), tokens };
}

/**
 * The tokens as filters. A `folder:` name matches every folder whose name
 * contains it (any case), and `folder:shared` also the notes shared with me;
 * several `folder:` tokens keep the folders that all of them match.
 */
export function toSearchFilters(tokens: SearchToken[], folderNames: Map<string, string>): SearchFilters {
    const filters: SearchFilters = {};
    for (const token of tokens) {
        const value = token.value.toLowerCase();
        if (token.kind === 'tag') {
            filters.tags = [...(filters.tags ?? []), value];
        } else if (token.kind === 'folder') {
            const ids = [...folderNames].filter(([, name]) => name.toLowerCase().includes(value)).map(([id]) => id);
            if (value === 'shared') ids.push(COLLABORATIVE_FOLDER_ID);
            filters.folderIds = filters.folderIds ? filters.folderIds.filter((id) => ids.includes(id)) : ids;
        } else if (token.kind === 'is') {
            filters[value as 'pinned' | 'shared' | 'public'] = true;
        } else if (token.kind === 'after') {
            if (!filters.after || token.at! > filters.after) filters.after = token.at;
        } else if (!filters.before || token.at! < filters.before) {
            filters.before = token.at;
        }
    }
    return filters;
}

/**
 * The filter being typed at the caret: `tag:re|`, `#re|`, `folder:"two wo|`.
 * `start` and `end` hold the whole word, which a suggestion replaces.
 */
export function tokenAtCaret(
    query: string,
    caret: number,
): { key: SearchToken['kind']; hash: boolean; value: string; start: number; end: number } | null {
    const match = /(^|\s)(#|tag:|folder:|is:|before:|after:)("[^"]*|[^\s"]*)$/i.exec(query.slice(0, caret));
    if (!match) return null;
    const start = match.index + match[1].length;
    // A token inside a phrase is text.
    if ((query.slice(0, start).split('"').length - 1) % 2 === 1) return null;
    const hash = match[2] === '#';
    return {
        key: hash ? 'tag' : (match[2].slice(0, -1).toLowerCase() as SearchToken['kind']),
        hash,
        value: match[3].replace(/^"/, ''),
        start,
        end: caret + (/^[^\s"]*"?/.exec(query.slice(caret))?.[0].length ?? 0),
    };
}
