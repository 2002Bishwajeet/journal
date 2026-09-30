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

export const shareRemarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath];

// Order: parse raw HTML -> sanitize -> highlight code -> render math. Highlighting
// and KaTeX run after the sanitizer so their trusted markup isn't stripped.
export const shareRehypePlugins: Options['rehypePlugins'] = [
    rehypeRaw,
    [rehypeSanitize, sanitizeSchema],
    rehypeLowlight,
    rehypeKatex,
];
