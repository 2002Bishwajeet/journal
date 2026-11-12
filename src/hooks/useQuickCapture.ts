import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { useNotes } from '@/hooks/useNotes';
import { isNativeApp } from '@/lib/native';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { splitCapture } from '@/lib/quickCapture';
import { useCanEdit } from '@/hooks/useCanEdit';

async function hideCaptureWindow(): Promise<void> {
    if (!isNativeApp()) return;
    const { quickCapture } = await import('@premium');
    await quickCapture?.hide();
}

/**
 * The quick-capture window (#1014): a bare text area. Cmd/Ctrl+Enter turns the text into a
 * note in the default folder and hides the window; Esc hides it and keeps the draft, so the
 * next open continues it (the native window is hidden, not closed).
 */
export function useQuickCapture() {
    const { createNoteWithContent } = useNotes();
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const input = useRef<HTMLTextAreaElement>(null);
    // The native trial ended (#1176): nothing is saved; Esc still hides the window.
    const canEdit = useCanEdit();

    // The native window is shown again by the hotkey: take the focus back into the text.
    useEffect(() => {
        const refocus = () => input.current?.focus();
        window.addEventListener('focus', refocus);
        return () => window.removeEventListener('focus', refocus);
    }, []);

    const hide = () => {
        hideCaptureWindow().catch((err: unknown) => console.error('[useQuickCapture] Failed to hide:', err));
    };

    const save = async () => {
        const note = splitCapture(text);
        if (!note || saving || !canEdit) return;
        setSaving(true);
        try {
            await createNoteWithContent.mutateAsync({ ...note, folderId: MAIN_FOLDER_ID });
            setText('');
            if (isNativeApp()) hide();
            else toast.success('Saved to Journal');
        } catch (err) {
            console.error('[useQuickCapture] Failed to save:', err);
            toast.error("Couldn't save the note");
        } finally {
            setSaving(false);
        }
    };

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            hide();
        }
    };

    return { text, setText, saving, canEdit, input, onKeyDown };
}
