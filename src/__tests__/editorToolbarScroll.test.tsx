// @vitest-environment happy-dom
/** The desktop toolbar scrolls sideways instead of wrapping, so nothing it opens may render inside it. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import EditorToolbar from '@/components/editor/EditorToolbar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let editor: Editor;
let root: Root;

beforeEach(async () => {
  // Desktop: pickers are popovers, not bottom sheets.
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const element = document.body.appendChild(document.createElement('div'));
  editor = new Editor({ element, extensions: createBaseExtensions(), content: '<p>Hello world</p>' });
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root.render(createElement(EditorToolbar, { editor: editor as never, onToggleToc: () => {} })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  editor.destroy();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const toolbar = () => document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Formatting"]')!;

describe('EditorToolbar', () => {
  it('is one scrolling row whose items never shrink', () => {
    const classes = toolbar().classList;
    expect(classes).toContain('overflow-x-auto');
    expect(classes).toContain('*:shrink-0');
    expect(classes).not.toContain('flex-wrap');
  });

  it.each(['Add Link (Cmd+Shift+K)', 'Math Formula', 'Text Alignment', 'Insert Table', 'Emoji'])(
    'opens the %s popover outside the scroll container',
    async (title) => {
      const trigger = toolbar().querySelector<HTMLButtonElement>(`button[title="${title}"]`)!;
      expect(trigger).not.toBeNull();
      // Radix triggers open on pointerdown in some versions and on click in others; send both.
      await act(async () => {
        trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        trigger.click();
      });
      const content = document.querySelector('[data-radix-popper-content-wrapper]');
      expect(content).not.toBeNull();
      expect(toolbar().contains(content)).toBe(false);
    },
  );
});
