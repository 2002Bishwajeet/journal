import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Editor } from '@tiptap/react';
import { findMatchesInDoc } from '@/components/editor/plugins/SearchAndReplaceExtension';

/**
 * Opens Find in note at the word a Search result matched. Search passes it as router state
 * (`{ find }`); once this note is the active one and loaded, the bar opens with it and the state
 * is cleared, so Back, reload and tab switches do not open it again. A word the note no longer
 * holds (it changed since it was indexed) opens nothing.
 */
export function useFindOnOpen(editor: Editor | null, isLoading: boolean, isActive: boolean) {
    const location = useLocation();
    const navigate = useNavigate();
    const find = (location.state as { find?: string } | null)?.find;

    useEffect(() => {
        if (!find || !isActive || isLoading || !editor || editor.isDestroyed) return;

        let frame = 0;
        const open = () => {
            // A desktop tab is shown a render after the route says it is active. Scrolling or
            // focusing inside it before then does nothing, so wait until it has a box.
            if (!editor.view.dom.getClientRects().length) {
                frame = requestAnimationFrame(open);
                return;
            }
            if (findMatchesInDoc(editor.state.doc, find, false, false).length > 0) {
                editor.chain().openFind(find).run();
            }
            // Other state (an open phone sheet's history entry) stays.
            const { find: _find, ...rest } = location.state as { find?: string };
            navigate(location, { replace: true, state: rest });
        };
        open();
        return () => cancelAnimationFrame(frame);
    }, [find, isActive, isLoading, editor, navigate, location]);
}
