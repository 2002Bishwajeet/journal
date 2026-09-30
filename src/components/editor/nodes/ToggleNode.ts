/**
 * Toggle (collapsible) block (#159) — schema only. The React node view
 * (ToggleNodeView) is layered on in editorExtensions.ts so headless code keeps
 * a React-free schema. Open/closed is view-local state and never stored.
 */
import { Node, mergeAttributes } from '@tiptap/core';

const isSummary = (n: ChildNode) => n.nodeName === 'SUMMARY';

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      summary: {
        default: '',
        parseHTML: (el) =>
          el.getAttribute('data-summary') ?? Array.from(el.childNodes).find(isSummary)?.textContent?.trim() ?? '',
        renderHTML: (attrs) => ({ 'data-summary': attrs.summary }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="toggle"]' },
      {
        tag: 'details',
        // The <summary> is the title attribute, not body content.
        contentElement: (el) => {
          const body = el.ownerDocument.createElement('div');
          el.childNodes.forEach((child) => {
            if (!isSummary(child)) body.appendChild(child.cloneNode(true));
          });
          return body;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'toggle' }), 0];
  },
});
