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
