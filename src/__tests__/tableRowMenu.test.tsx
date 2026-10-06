// @vitest-environment happy-dom
/** #449: the row menu's Header row toggle and Delete table button. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';

// A stable object: the menu stores hoveredCell in state, a fresh one per render would loop.
const hover: { state: { hoveredCell: unknown } } = { state: { hoveredCell: null } };
vi.mock('@/components/editor/table/hooks', () => ({ useTableState: () => hover.state }));

import { TableRowMenu } from '@/components/editor/table/TableRowMenu';

const TABLE =
  '<p>Before</p><table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>';

const firstRowTypes = (editor: Editor) => editor.state.doc.child(1).firstChild!.children.map((c) => c.type.name);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let editor: Editor;
let root: Root;
let host: HTMLElement;
const openMenu = () =>
  act(async () => {
    host.querySelector<HTMLButtonElement>('button[aria-label="Row options"]')!.click();
  });

beforeEach(async () => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({ element, extensions: createBaseExtensions(), content: TABLE });
  // The menu belongs to the second row: the toggle must still act on the first.
  hover.state = {
    hoveredCell: { node: element.querySelectorAll('tr')[1].querySelector('td'), rowIndex: 1, colIndex: 0, rect: new DOMRect(0, 0, 50, 20) },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(TableRowMenu, { editor: editor as never })));
  await openMenu();
});
afterEach(async () => {
  await act(async () => root.unmount());
  editor.destroy();
  document.body.innerHTML = '';
});

const button = (name: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

describe('TableRowMenu', () => {
  it('Header row toggles the first row on and off and reflects it in aria-pressed', async () => {
    expect(button('Header row').getAttribute('aria-pressed')).toBe('false');
    await act(async () => button('Header row').click());
    expect(firstRowTypes(editor)).toEqual(['tableHeader', 'tableHeader']);
    await openMenu();
    expect(button('Header row').getAttribute('aria-pressed')).toBe('true');
    await act(async () => button('Header row').click());
    expect(firstRowTypes(editor)).toEqual(['tableCell', 'tableCell']);
    await openMenu();
    expect(button('Header row').getAttribute('aria-pressed')).toBe('false');
  });

  it('Delete table removes the table and keeps the rest of the note', async () => {
    await act(async () => button('Delete table').click());
    let tables = 0;
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'table') tables++;
    });
    expect(tables).toBe(0);
    expect(editor.getText()).toContain('Before');
  });
});
