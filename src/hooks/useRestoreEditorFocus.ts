import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';

/**
 * For a sheet opened from the editor (#827): remembers the selection when `open` turns true and
 * returns an `onCloseAutoFocus` handler that gives focus and the selection back to the editor.
 * If the note changed while the sheet was open (an emoji, a link), the command already put the
 * caret where it belongs, so only focus returns.
 */
export function useRestoreEditorFocus(editor: Editor, open: boolean) {
  const saved = useRef<{ doc: Node; from: number; to: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const { doc, selection } = editor.state;
    saved.current = { doc, from: selection.from, to: selection.to };
  }, [open, editor]);

  return (event: Event) => {
    event.preventDefault();
    const before = saved.current;
    const chain = editor.chain().focus();
    if (before && editor.state.doc === before.doc) chain.setTextSelection({ from: before.from, to: before.to });
    chain.run();
  };
}
