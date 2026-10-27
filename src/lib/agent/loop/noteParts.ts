/**
 * A long note in parts (#797). A small model's 4k window can't hold a long note, so the
 * agent reads it one part at a time, and the open note's first-turn context names its parts
 * and headings instead of cutting the body silently. Parts are cut at blocks and headings,
 * and sized with the prompt estimate of `trim.ts`.
 */
import { estimateTokens } from './trim';

/** A part of a note for `get_note`: about 1,500 characters. */
export const NOTE_PART_TOKENS = 500;
/** Headings past this many are left out of the outline: each one costs prompt tokens. */
const OUTLINE_LIMIT = 20;

const isHeading = (block: string) => /^#{1,6}\s/.test(block);
const join = (a: string, b: string) => (a ? `${a}\n\n${b}` : b);

/** The markdown's top-level blocks: split at blank lines, but a fenced code block stays whole. */
function blocks(markdown: string): string[] {
    const out: string[] = [];
    let lines: string[] = [];
    let fenced = false;
    for (const line of markdown.split('\n')) {
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
        if (fenced || line.trim()) lines.push(line);
        else if (lines.length) {
            out.push(lines.join('\n'));
            lines = [];
        }
    }
    if (lines.length) out.push(lines.join('\n'));
    return out;
}

/** A block too long for one part, cut at line breaks, else sentence ends, else spaces. */
function cut(block: string, budget: number): string[] {
    const pieces: string[] = [];
    let rest = block;
    while (estimateTokens(rest) > budget) {
        // The longest text the estimate (characters / 3) fits in the budget.
        const head = rest.slice(0, budget * 3);
        const at = [head.lastIndexOf('\n'), head.lastIndexOf('. ') + 1, head.lastIndexOf(' ')].find((i) => i > head.length / 2) ?? head.length;
        pieces.push(rest.slice(0, at).trimEnd());
        rest = rest.slice(at).trimStart();
    }
    return [...pieces, rest];
}

/**
 * Splits markdown into parts of at most `budget` estimated tokens, at block boundaries. A
 * heading starts a new part when its section does not fit in what is left of the current one.
 * There is always at least one part.
 */
export function splitNote(markdown: string, budget: number): string[] {
    const fits = (text: string) => estimateTokens(text) <= budget;
    const all = blocks(markdown);
    const parts: string[] = [];
    let part = '';
    all.forEach((block, i) => {
        if (part && isHeading(block)) {
            const end = all.findIndex((b, j) => j > i && isHeading(b));
            if (!fits(join(part, all.slice(i, end === -1 ? undefined : end).join('\n\n')))) {
                parts.push(part);
                part = '';
            }
        }
        for (const piece of cut(block, budget)) {
            if (part && !fits(join(part, piece))) {
                parts.push(part);
                part = '';
            }
            part = join(part, piece);
        }
    });
    parts.push(part);
    return parts;
}

/** The headings of the parts, each with the part it is in. */
export function outline(parts: string[]): string[] {
    const headings = parts.flatMap((part, i) => blocks(part).filter(isHeading).map((h) => `${h.replace(/^#+\s*/, '')} (part ${i + 1})`));
    return headings.length > OUTLINE_LIMIT ? [...headings.slice(0, OUTLINE_LIMIT), '…'] : headings;
}

/** One part of a note as `get_note` gives it to the agent: the part's markdown, the part count and the outline. */
export function notePart<Note extends { markdown: string }>(note: Note, part: number) {
    const parts = splitNote(note.markdown, NOTE_PART_TOKENS);
    if (part > parts.length) throw new Error(`The note has ${parts.length} ${parts.length === 1 ? 'part' : 'parts'}; there is no part ${part}.`);
    return { ...note, part, parts: parts.length, outline: outline(parts), markdown: parts[part - 1] };
}

/** The open note as the model first sees it: title, id, part count and outline, not the body. */
export function openNoteContext(note: { id: string; title: string; parts: number; outline: string[] }): string {
    const parts = note.parts === 1 ? '1 part' : `${note.parts} parts`;
    const headings = note.outline.length ? `. Outline: ${note.outline.join('; ')}` : '';
    return `Open note: "${note.title}" (id: ${note.id}), ${parts}${headings}\n`;
}
