/**
 * Callout block (#159) — schema only. The React node view (CalloutNodeView) is
 * layered on in editorExtensions.ts so headless code keeps a React-free schema.
 *
 * Enter on an empty last paragraph lifts out through ProseMirror's default
 * `liftEmptyBlock`, the same as a blockquote.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { knownCalloutVariant, toCalloutVariant } from './calloutVariants';
import { inListItem, parseMarkdownBody } from './markdownParse';

// What fragmentToMarkdown emits: `> [!variant]`, then the body quoted with `> `.
// Agents also write the Obsidian/GitHub form: any type in any case, a fold
// marker, and a title on the marker line (`> [!WARNING]- Fix first`).
const CALLOUT_MARKDOWN = /^> ?\[!([\w-]+)\][+-]?[ \t]*([^\n]*)(?:\n|$)((?:>.*(?:\n|$))*)/;

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (el) => toCalloutVariant(el.getAttribute('data-variant')),
        renderHTML: (attrs) => ({ 'data-variant': toCalloutVariant(attrs.variant) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },

  // Markdown -> callout (#392). Only the agent edit engine parses markdown.
  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    // Line where the next candidate starts, so marked ends a paragraph before it.
    start: (src) => {
      const at = src.search(/\n> ?\[!/);
      return at < 0 ? -1 : at + 1;
    },
    tokenize(src, tokens, lexer) {
      const match = CALLOUT_MARKDOWN.exec(src);
      if (!match || inListItem(tokens)) return undefined;
      const [raw, type, rawTitle, quoted] = match;
      const variant = knownCalloutVariant(type);
      if (!variant) return undefined;
      const title = rawTitle.trim();
      const body = quoted.replace(/^> ?/gm, '').trimEnd();
      if (!title) {
        // The serializer trims the body, so a blank line after the marker means a
        // blockquote whose first paragraph happens to be `[!variant]`.
        if (!quoted || body.startsWith('\n')) return undefined;
      }
      // A title becomes a bold first line, as the importer does (markdownImport.ts).
      const rest = body.replace(/^\n+/, '');
      const source = title ? `**${title}**${rest ? `\n\n${rest}` : ''}` : body;
      return { type: 'callout', raw, variant, tokens: lexer.blockTokens(source) };
    },
  },

  parseMarkdown: (token, helpers) =>
    helpers.createNode('callout', { variant: token.variant }, parseMarkdownBody(token.tokens, helpers)),

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0];
  },
});
