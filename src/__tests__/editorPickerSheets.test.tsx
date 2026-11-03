// @vitest-environment happy-dom
/** #827: on touch layouts the table and align pickers and the link form are sheets, not popovers or prompts. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { TablePicker } from '@/components/editor/TablePicker';
import { TextAlignPicker } from '@/components/editor/TextAlignPicker';
import { LinkSheet } from '@/components/editor/LinkSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let editor: Editor;
let host: HTMLElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({ element, extensions: createBaseExtensions(), content: '<p>Hello world</p>' });
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  editor.destroy();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const mount = (node: Parameters<Root['render']>[0]) => act(async () => root.render(node));
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());
const byLabel = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
const byText = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!;
const dialog = () => document.querySelector('[role="dialog"]');

describe('TablePicker on a touch layout', () => {
  it('opens a sheet with steppers at 3 x 3 and inserts the size they show', async () => {
    await mount(createElement(TablePicker, { editor: editor as never }));
    await click(document.querySelector('button[title="Insert Table"]'));
    expect(dialog()?.getAttribute('data-variant')).toBe('bottom');

    await click(byLabel('More columns'));
    await click(byLabel('Fewer rows'));
    await click(byLabel('Fewer rows'));
    await click(byText('Insert table'));

    let rows = 0;
    let cols = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'table') {
        rows = node.childCount;
        cols = node.firstChild!.childCount;
      }
    });
    expect({ rows, cols }).toEqual({ rows: 1, cols: 4 });
  });

  it('stops the steppers at 1 and 10', async () => {
    await mount(createElement(TablePicker, { editor: editor as never }));
    await click(document.querySelector('button[title="Insert Table"]'));
    for (let n = 0; n < 2; n++) await click(byLabel('Fewer columns'));
    expect(byLabel('Fewer columns').disabled).toBe(true);
    for (let n = 0; n < 9; n++) await click(byLabel('More columns'));
    expect(byLabel('More columns').disabled).toBe(true);
  });
});

describe('TextAlignPicker on a touch layout', () => {
  it('opens an action sheet with the current alignment checked and applies the one tapped', async () => {
    await mount(createElement(TextAlignPicker, { editor: editor as never, currentAlign: 'center' }));
    await click(document.querySelector('button[title="Text Alignment"]'));

    const rows = [...document.querySelectorAll('[role="menuitemradio"]')];
    expect(rows.map((r) => r.textContent)).toEqual(['Left', 'Center', 'Right', 'Justify']);
    expect(rows.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);

    await click(rows[2]);
    expect(editor.getAttributes('paragraph').textAlign).toBe('right');
  });
});

describe('LinkSheet', () => {
  const open = (onOpenChange = vi.fn()) =>
    mount(createElement(LinkSheet, { editor: editor as never, open: true, onOpenChange }));
  const setValue = (id: string, value: string) =>
    act(async () => {
      const input = document.getElementById(id) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

  it('fills Text from the selection, takes a URL and links the word on Done', async () => {
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const onOpenChange = vi.fn();
    await open(onOpenChange);

    expect((document.getElementById('editor-link-text') as HTMLInputElement).value).toBe('Hello');
    const url = document.getElementById('editor-link-url') as HTMLInputElement;
    expect(url.type).toBe('url');
    expect(url.inputMode).toBe('url');
    expect(byText('Remove link')).toBeUndefined();
    expect(byText('Done').disabled).toBe(true);

    await setValue('editor-link-url', 'example.com');
    await act(async () => {
      document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(editor.getHTML()).toContain('href="https://example.com"');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('offers Remove link on an existing link and removes it', async () => {
    editor.commands.setContent('<p>See <a href="https://a.test">the docs</a></p>');
    editor.commands.setTextSelection(8);
    await open();

    expect((document.getElementById('editor-link-url') as HTMLInputElement).value).toBe('https://a.test');
    await click(byText('Remove link'));
    expect(editor.getHTML()).not.toContain('<a ');
  });
});
