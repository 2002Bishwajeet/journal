/**
 * Pure Markdown transforms for import (#593). They turn the syntax an Obsidian vault
 * uses (wiki links, embeds, `#tags`, callouts, YAML front-matter) into Journal's.
 * Markdown that doesn't use that syntax passes through unchanged, so they apply to
 * every import with no format detection. Code (fenced and inline) is never touched.
 */
import type { CalloutVariant } from '@/components/editor/nodes/calloutVariants';

/** A note of the import batch: its path in the zip and its new doc id. */
export interface ImportedNote {
    path: string;
    id: string;
}

export interface FrontMatter {
    title: string;
    tags: string[];
    created?: string;
    modified?: string;
    excludeFromAI: boolean;
    content: string;
}

// The types the editor accepts on paste/drop (FileHandler), by file extension
export const IMAGE_TYPES: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
};

/** A path Obsidian or macOS keeps for itself: `.obsidian/`, `.trash/`, any dot segment, `__MACOSX/`. */
export function isSkippedPath(path: string): boolean {
    return path.split('/').some((segment) => segment.startsWith('.') || segment === '__MACOSX');
}

/** `Vault/` when every path sits under that one top-level folder (a zipped vault), else ''. */
export function commonRoot(paths: readonly string[]): string {
    const tops = new Set(paths.map((p) => (p.includes('/') ? p.split('/')[0] : '')));
    const [top] = tops;
    return tops.size === 1 && top ? `${top}/` : '';
}

/** The Journal folder name for a note: its top-level folder once `root` is stripped; '' at the root. */
export function folderOf(path: string, root: string): string {
    const parts = path.slice(root.length).split('/');
    return parts.length > 1 ? parts[0] : '';
}

/**
 * The zip path a link target points at, relative to the note at `notePath`;
 * null for a URL (http:, data:, attachment:, ...), which stays as it is.
 */
export function resolveImagePath(notePath: string, target: string): string | null {
    const src = target.replace(/^<|>$/g, '').replace(/[?#].*$/, '');
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return null;
    let decoded = src;
    try { decoded = decodeURIComponent(src); } catch { /* keep the raw path */ }
    const parts = decoded.startsWith('/') ? [] : notePath.split('/').slice(0, -1);
    for (const segment of decoded.split('/')) {
        if (segment === '..') parts.pop();
        else if (segment && segment !== '.') parts.push(segment);
    }
    return parts.join('/');
}

const unquote = (v: string) => v.trim().replace(/^["']|["']$/g, '');

/** Front-matter (LF or CRLF) and the body after it. Tags may be `[a, b]`, `a, b` or a YAML list. */
export function parseFrontMatter(text: string): FrontMatter {
    const normalized = text.replace(/\r\n?/g, '\n');
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(normalized);
    const result: FrontMatter = { title: '', tags: [], excludeFromAI: false, content: normalized };
    if (!match) return { ...result, content: normalized.trim() };

    const tags: string[] = [];
    let listKey = ''; // the key whose `- item` lines follow
    for (const line of match[1].split('\n')) {
        const item = /^\s*-\s+(.*)$/.exec(line);
        if (item) {
            if (listKey === 'tags') tags.push(item[1]);
            continue;
        }
        const at = line.indexOf(':');
        if (at < 0) continue;
        const key = line.slice(0, at).trim();
        const value = line.slice(at + 1).trim();
        listKey = value ? '' : key;
        if (key === 'title') result.title = unquote(value);
        if (key === 'created') result.created = unquote(value);
        if (key === 'modified') result.modified = unquote(value);
        if (key === 'excludeFromAI') result.excludeFromAI = unquote(value) === 'true';
        if (key === 'tags') tags.push(...value.replace(/^\[|\]$/g, '').split(','));
    }
    result.tags = [...new Set(tags.map((t) => unquote(t).replace(/^#/, '')).filter(Boolean))];
    return { ...result, content: normalized.slice(match[0].length).trim() };
}

// A fenced block (to its closing fence, or the end), or an inline code span
const CODE = /^[ \t]*(`{3,}|~{3,}).*\n[\s\S]*?^[ \t]*\1.*$|^[ \t]*(`{3,}|~{3,})[\s\S]*|(`+)[^\n]*?\3/gm;
const MASK = /\uE000(\d+)\uE000/g;

/** Applies `transform` to `markdown` with its code swapped out for placeholders. */
function outsideCode(markdown: string, transform: (text: string) => string): string {
    const code: string[] = [];
    const masked = markdown.replace(CODE, (m) => `\uE000${code.push(m) - 1}\uE000`);
    return transform(masked).replace(MASK, (_, i: string) => code[Number(i)]);
}

// `#tag` or `#nested/tag` after whitespace: not a heading (`# H`), a URL fragment or a wiki-link heading
const INLINE_TAG = /(?<=^|\s)#([\p{L}\p{N}_/-]+)/gu;

/** The body's inline `#tags`, outside code. A number alone (`#1`) is not a tag, as in Obsidian. */
export function inlineTags(markdown: string): string[] {
    const tags = new Set<string>();
    outsideCode(markdown, (text) => {
        for (const [, tag] of text.matchAll(INLINE_TAG)) {
            const clean = tag.replace(/\/+$/, '');
            if (/[^\d/]/.test(clean)) tags.add(clean);
        }
        return text;
    });
    return [...tags];
}

const CALLOUT_TYPES: Record<string, CalloutVariant> = {
    tip: 'tip', hint: 'tip', important: 'tip', success: 'tip', check: 'tip', done: 'tip',
    warning: 'warning', caution: 'warning', attention: 'warning',
    danger: 'error', error: 'error', bug: 'error', failure: 'error', fail: 'error', missing: 'error',
};
// `> [!TYPE]`, optionally foldable (`+`/`-`) and titled
const CALLOUT = /^>[ \t]*\[!([\w-]+)\][+-]?[ \t]*(.*)$/gm;

/** `> [!NOTE]-  Title` → `> [!info]` with the title as a bold first line, the form the editor parses. */
function convertCallouts(text: string): string {
    return text.replace(CALLOUT, (_, type: string, title: string) => {
        const variant = CALLOUT_TYPES[type.toLowerCase()] ?? 'info';
        return title.trim() ? `> [!${variant}]\n> **${title.trim()}**\n>` : `> [!${variant}]`;
    });
}

/** The one path equal to `target` or ending in `/target`, case-insensitively; null if none or several. */
function findPath(paths: readonly string[], target: string): string | null {
    const key = target.replace(/^\/+/, '').toLowerCase();
    const found = paths.filter((p) => {
        const path = p.toLowerCase();
        return path === key || path.endsWith(`/${key}`);
    });
    return found.length === 1 ? found[0] : null;
}

const noteLink = (label: string, id: string) => `[${label.replace(/[\\[\]]/g, '\\$&')}](journal:note/${id})`;
const baseName = (path: string) => path.split('/').pop()!;
// A zip path as an absolute link target that resolveImagePath reads back
const encodePath = (path: string) =>
    `/${path.split('/').map((s) => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/')}`;

// [[target#heading|alias]] or ![[embed|size]]; `\|` is how a table escapes the pipe
const WIKI = /(!?)\[\[([^[\]\n]+)\]\]/g;
// [text](target "title") that isn't an image
const MD_LINK = /(?<!!)\[([^\]\n]*)\]\(\s*(<[^>]*>|[^)\n]*?)(\s+"[^"]*")?\s*\)/g;

/**
 * A note's body with Obsidian syntax in Journal's form. Wiki links, note embeds and
 * relative `.md` links to a note of `notes` become note links; one that matches no note
 * (or several) is its label as text. An image embed becomes an image link to its file
 * in `files` (found by name anywhere in the zip), or its file name when it isn't there.
 * Callouts take the form the editor parses.
 */
export function convertMarkdown(
    markdown: string,
    notePath: string,
    notes: readonly ImportedNote[],
    files: readonly string[]
): string {
    const notePaths = notes.map((n) => n.path.replace(/\.md$/i, ''));
    const linkTo = (target: string, label: string) => {
        const path = findPath(notePaths, target.replace(/\.md$/i, ''));
        return path === null ? label : noteLink(label, notes[notePaths.indexOf(path)].id);
    };

    return outsideCode(markdown, (text) => convertCallouts(text)
        .replace(WIKI, (_, embed: string, inner: string) => {
            const [target, alias = ''] = inner.split(/\\?\|/);
            const name = target.split('#')[0].trim();
            const ext = /\.([^./]+)$/.exec(name)?.[1].toLowerCase();
            if (embed && ext && ext !== 'md') {
                const file = IMAGE_TYPES[ext] ? findPath(files, name) : null;
                return file ? `![${baseName(file).replace(/[[\]]/g, '')}](${encodePath(file)})` : baseName(name);
            }
            const label = alias.trim() || name.replace(/\.md$/i, '') || target.replace(/^#\^?/, '').trim();
            return name ? linkTo(name, label) : label;
        })
        .replace(MD_LINK, (full, label: string, target: string) => {
            const path = resolveImagePath(notePath, target);
            const note = path?.toLowerCase().endsWith('.md') ? notes.find((n) => n.path === path) : undefined;
            return note ? noteLink(label || baseName(path!).replace(/\.md$/i, ''), note.id) : full;
        }));
}
