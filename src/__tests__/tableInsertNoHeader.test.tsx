// @vitest-environment happy-dom
/** #446: tables inserted from the toolbar picker and from /table have no header row. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { TablePicker } from '@/components/editor/TablePicker';
import { slashCommandItems } from '@/components/editor/plugins/SlashCommands/slashCommandItems';

const cellTypes = (editor: Editor) => {
  const types: string[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') types.push(n.type.name);
  });
  return types;
};

let editor: Editor;
beforeEach(() => {
  editor = new Editor({ element: document.createElement('div'), extensions: createBaseExtensions() });
});
afterEach(() => editor.destroy());

describe('table insertion default', () => {
  it('/table inserts a table with no header cells', () => {
    const item = slashCommandItems.find((i) => i.title === 'Table')!;
    item.command({ editor, range: { from: 1, to: 1 } } as Parameters<typeof item.command>[0]);
    const types = cellTypes(editor);
    expect(types).toHaveLength(9);
    expect(types).not.toContain('tableHeader');
  });

  it('the table picker inserts a table with no header cells', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    await act(async () => {
      root.render(createElement(TablePicker, { editor: editor as never }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[title="Insert Table"]')!.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="2 by 3 table"]')!.click();
    });
    const types = cellTypes(editor);
    expect(types).toHaveLength(6);
    expect(types).not.toContain('tableHeader');
    await act(async () => root.unmount());
    host.remove();
  });
});
