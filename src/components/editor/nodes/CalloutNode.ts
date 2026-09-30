/**
 * Callout block (#159) — schema only. The React node view (CalloutNodeView) is
 * layered on in editorExtensions.ts so headless code keeps a React-free schema.
 *
 * Enter on an empty last paragraph lifts out through ProseMirror's default
 * `liftEmptyBlock`, the same as a blockquote.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { toCalloutVariant } from './calloutVariants';

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

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'callout' }), 0];
  },
});
