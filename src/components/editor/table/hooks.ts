
import { useEffect, useState, useCallback } from 'react';
import { Editor } from '@tiptap/react';


export function useTableState(editor: Editor | null, open: boolean) {
    const [activeCell, setActiveCell] = useState<{
        pos: number;
        node: HTMLElement | null;
        rowIndex: number;
        colIndex: number;
    } | null>(null);

    const updateTableState = useCallback(() => {
        if (!editor || open) return;

        const { selection } = editor.state;
        if (!selection) return;

        // Find the cell closest to the selection
        // This part requires traversing the DOM or using Tiptap's pos finding
        // simplified approach: use domAtPos

        try {
            // Check if we are inside a table
            if (!editor.isActive('table')) {
                setActiveCell(null);
                return;
            }

            const view = editor.view;
            const domAtPos = view.domAtPos(selection.anchor);

            let node = domAtPos.node as HTMLElement;

            // Traverse up to find TD or TH
            while (node && node.nodeName !== 'TD' && node.nodeName !== 'TH' && node.nodeName !== 'BODY') {
                node = node.parentElement as HTMLElement;
            }

            if (node && (node.nodeName === 'TD' || node.nodeName === 'TH')) {
                // We found a cell. Now we need its row/col index if possible.
                // Tiptap doesn't easily expose this from the DOM node alone without
                // resolvable positions, but for handles we mainly just need the DOM rect.
                // We can get rowIndex from tr parent.

                const tr = node.parentElement as HTMLTableRowElement;
                const rowIndex = tr ? (tr.rowIndex) : -1; // Note: this might be relative to table or section
                const colIndex = (node as HTMLTableCellElement).cellIndex;

                setActiveCell({
                    pos: selection.anchor,
                    node,
                    rowIndex,
                    colIndex
                });
            } else {
                setActiveCell(null);
            }
        } catch (e) {
            console.warn("Error updating table state", e);
            setActiveCell(null);
        }
    }, [editor, open]);

    useEffect(() => {
        if (!editor) return;

        editor.on('selectionUpdate', updateTableState);
        editor.on('update', updateTableState);
        editor.on('blur', () => {
            // Optional: hide on blur? keeping it simple for now
        });

        return () => {
            editor.off('selectionUpdate', updateTableState);
            editor.off('update', updateTableState);
            editor.off('blur', updateTableState);
        };
    }, [editor, updateTableState]);

    return activeCell;
}
