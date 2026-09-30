const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Words of prose in a note's markdown, for the share page's reading time.
 * Code, math, images and link URLs are not read as prose, so they are dropped;
 * link text is kept.
 */
export function countWords(markdown: string): number {
    const prose = markdown
        .replace(/(```|~~~)[\s\S]*?\1/g, ' ') // fenced code
        .replace(/\$\$[\s\S]*?\$\$/g, ' ') // block math
        .replace(/\$[^$\n]+\$/g, ' ') // inline math
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> their text
        .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, ' ') // list markers
        .replace(/[`#*_~>|[\]]/g, ' '); // inline code markers + markdown punctuation
    // Drop runs left with no letter or digit (table rules, `---`, stray punctuation).
    return (prose.match(/\S+/g) ?? []).filter((run) => /[\p{L}\p{N}]/u.test(run)).length;
}

/** A long, localized date, e.g. "January 2, 2026". */
export function formatShareDate(iso: string, locale?: string): string {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(iso));
}

/** Show an "Updated" date only when it is more than a day from the published date. */
export function showUpdated(createdIso: string, updatedIso: string): boolean {
    return Math.abs(Date.parse(updatedIso) - Date.parse(createdIso)) > DAY_MS;
}
