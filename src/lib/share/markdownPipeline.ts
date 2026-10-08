import type { Element, ElementContent, Root } from 'hast';
import type { Options } from 'react-markdown';
import { common, createLowlight } from 'lowlight';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import { sanitizeSchema } from '@/lib/utils/shareSanitizeSchema';

const lowlight = createLowlight(common);
// A `react` live block's code is JSX, which the javascript grammar highlights (#426).
lowlight.registerAlias({ javascript: ['react'] });

function textOf(node: ElementContent): string {
    if (node.type === 'text') return node.value;
    if (node.type === 'element') return node.children.map(textOf).join('');
    return '';
}

function highlightCode(code: Element): void {
    const classes = code.properties.className;
    const language = Array.isArray(classes)
        ? classes.map(String).find((c) => c.startsWith('language-'))?.slice('language-'.length)
        : undefined;
    if (!language || !lowlight.registered(language)) return;
    // Highlighted output is text + <span class="hljs-*"> only, so it is safe to add
    // after sanitizing (the sanitizer would strip the hljs classes).
    code.children = lowlight.highlight(language, code.children.map(textOf).join('')).children as ElementContent[];
}

/**
 * Syntax-highlights `pre > code.language-xxx` blocks for languages lowlight's
 * `common` set knows; any other code block is left as is.
 */
export function rehypeLowlight() {
    return (tree: Root) => {
        const walk = (parent: Root | Element) => {
            for (const child of parent.children) {
                if (child.type !== 'element') continue;
                if (child.tagName === 'pre') {
                    for (const code of child.children) {
                        if (code.type === 'element' && code.tagName === 'code') highlightCode(code);
                    }
                    continue;
                }
                walk(child);
            }
        };
        walk(tree);
    };
}

const PLAIN_TABLE_TAGS = new Set(['thead', 'tr', 'th', 'td']);

/** True when the node has no text and nothing but plain table wrappers (an image or link still counts as content). */
function isEmptyHead(node: ElementContent): boolean {
    if (node.type === 'text') return node.value.trim() === '';
    if (node.type !== 'element') return true;
    return PLAIN_TABLE_TAGS.has(node.tagName) && node.children.every(isEmptyHead);
}

/** Drops a `<thead>` whose cells are all empty: GFM's stand-in for "no header row" (#446). */
export function rehypeDropEmptyThead() {
    return (tree: Root) => {
        const walk = (parent: Root | Element) => {
            parent.children = parent.children.filter((child) => {
                if (child.type !== 'element') return true;
                if (child.tagName === 'thead' && isEmptyHead(child)) return false;
                walk(child);
                return true;
            });
        };
        walk(tree);
    };
}

/** Calls `visit` on every `code` element under `parent`. */
function eachCode(parent: Root | Element, visit: (code: Element) => void): void {
    for (const child of parent.children) {
        if (child.type !== 'element') continue;
        if (child.tagName === 'code') visit(child);
        eachCode(child, visit);
    }
}

// A code element's `data.meta` is the rest of its fence's info string, which holds a live
// block's id (```html id=k3f9, #410). rehype-raw rebuilds the tree without `data`, so the
// meta is set aside before it, by source position, and put back once the tree is
// sanitized. It is never an attribute, so the sanitizer has nothing to allow.
const metaByFile = new WeakMap<object, Map<number, string>>();

function rehypeKeepCodeMeta() {
    return (tree: Root, file: object) => {
        const metas = new Map<number, string>();
        eachCode(tree, (code) => {
            const offset = code.position?.start.offset;
            if (code.data?.meta && offset !== undefined) metas.set(offset, code.data.meta);
        });
        metaByFile.set(file, metas);
    };
}

function rehypeRestoreCodeMeta() {
    return (tree: Root, file: object) => {
        const metas = metaByFile.get(file);
        metaByFile.delete(file);
        if (!metas?.size) return;
        eachCode(tree, (code) => {
            const meta = metas.get(code.position?.start.offset ?? -1);
            if (meta) code.data = { ...code.data, meta };
        });
    };
}

const CLOBBER_PREFIX = 'user-content-';

/**
 * GFM footnotes (#518) come out of remark-rehype with ids already prefixed
 * (`user-content-fn-1`, which their links point at), and the sanitizer
 * prefixes them again. Drops the second prefix so the links and back links
 * land; every id still carries one.
 */
function rehypeSingleClobberPrefix() {
  return (tree: Root) => {
    const walk = (parent: Root | Element) => {
      for (const child of parent.children) {
        if (child.type !== 'element') continue;
        const { id } = child.properties;
        if (typeof id === 'string' && id.startsWith(CLOBBER_PREFIX + CLOBBER_PREFIX)) {
          child.properties.id = id.slice(CLOBBER_PREFIX.length);
        }
        walk(child);
      }
    };
    walk(tree);
  };
}

export const shareRemarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath];

// Order: parse raw HTML -> sanitize -> highlight code -> render math. Highlighting
// and KaTeX run after the sanitizer so their trusted markup isn't stripped.
export const shareRehypePlugins: Options['rehypePlugins'] = [
    rehypeKeepCodeMeta,
    rehypeRaw,
    [rehypeSanitize, sanitizeSchema],
    rehypeRestoreCodeMeta,
    rehypeSingleClobberPrefix,
    rehypeDropEmptyThead,
    rehypeLowlight,
    rehypeKatex,
];
