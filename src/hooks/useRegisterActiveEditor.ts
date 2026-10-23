import { useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { registerActiveEditor } from '@/lib/agent/activeEditor';

/** Makes this tab's editor the one the in-app agent's editor tools act on while the tab is active (#700). */
export function useRegisterActiveEditor(
    editor: Editor | null,
    { docId, isActive, editable, excludeFromAI }: { docId: string; isActive: boolean; editable: boolean; excludeFromAI: boolean }
) {
    useEffect(() => {
        if (!editor || !isActive) return;
        return registerActiveEditor({ docId, editor, editable, excludeFromAI });
    }, [editor, docId, isActive, editable, excludeFromAI]);
}
