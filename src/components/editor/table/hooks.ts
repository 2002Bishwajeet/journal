
import { useEffect, useState, useCallback } from 'react';
import { Editor } from '@tiptap/react';


export function useTableState(editor: Editor | null, open: boolean) {
    const [tableState, setTableState] = useState<{
        activeCell: {
            pos: number;
            node: HTMLElement | null;
            rowIndex: number;
            colIndex: number;
        } | null;
        hoveredCell: {
            node: HTMLElement | null;
            rowIndex: number;
            colIndex: number;
            rect: DOMRect;
        } | null;
    }>({ activeCell: null, hoveredCell: null });

    const updateTableState = useCallback(() => {
        if (!editor || open) return;

        const { selection } = editor.state;

        let newActiveCell = null;

        if (selection && editor.isActive('table')) {
            const view = editor.view;
            const domAtPos = view.domAtPos(selection.anchor);
            let node = domAtPos.node as HTMLElement;

            while (node && node.nodeName !== 'TD' && node.nodeName !== 'TH' && node.nodeName !== 'BODY') {
                node = node.parentElement as HTMLElement;
            }

            if (node && (node.nodeName === 'TD' || node.nodeName === 'TH')) {
                const tr = node.parentElement as HTMLTableRowElement;
                const rowIndex = tr ? (tr.rowIndex) : -1;
                const colIndex = (node as HTMLTableCellElement).cellIndex;

                newActiveCell = {
                    pos: selection.anchor,
                    node,
                    rowIndex,
                    colIndex
                };
            }
        }

        setTableState(prev => {
            // Only update if changed
            if (prev.activeCell?.node === newActiveCell?.node) return prev;
            return { ...prev, activeCell: newActiveCell };
        });

    }, [editor, open]);

    // Hover handler
    useEffect(() => {
        if (!editor) return;
        const view = editor.view;

        const handleMouseMove = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const cell = target.closest('td, th') as HTMLTableCellElement;

            if (!cell || !view.dom.contains(cell)) {
                setTableState(prev => (prev.hoveredCell ? { ...prev, hoveredCell: null } : prev));
                return;
            }

            const tr = cell.parentElement as HTMLTableRowElement;
            const rowIndex = tr ? tr.rowIndex : -1;
            const colIndex = cell.cellIndex;
            const rect = cell.getBoundingClientRect();

            setTableState(prev => {
                if (prev.hoveredCell?.node === cell) return prev;
                return {
                    ...prev,
                    hoveredCell: {
                        node: cell,
                        rowIndex,
                        colIndex,
                        rect
                    }
                };
            });
        };

        // Debounce or throttle this if needed, but for UI responsiveness direct is usually okay
        view.dom.addEventListener('mousemove', handleMouseMove);
        view.dom.addEventListener('mouseleave', () => setTableState(prev => ({ ...prev, hoveredCell: null })));

        return () => {
            view.dom.removeEventListener('mousemove', handleMouseMove);
        };

    }, [editor]);

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

    return tableState;
}
