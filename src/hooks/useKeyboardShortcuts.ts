import { useEffect } from 'react';
import { activeEditor } from '@/lib/agent/activeEditor';

interface KeyboardShortcutsConfig {
    onSearch?: () => void;
    onNewNote?: () => void;
    onSave?: () => void;
    onKeyboardHelp?: () => void;
    onFocusMode?: () => void;
    onDailyNote?: () => void;
    onEscape?: () => void;
    /** Cmd/Ctrl+F and Cmd/Ctrl+H open Find / Replace in the note on screen, wherever focus is. */
    findInNote?: boolean;
}

/** Runs a Find command on the note on screen; with no note open the key is left to the browser. */
function openInActiveNote(e: KeyboardEvent, command: 'openFind' | 'openReplace') {
    const active = activeEditor.get();
    // The editor's own Mod-f / Mod-h keymap already handled a key pressed in the note body.
    if (!active || active.editor.isDestroyed || e.defaultPrevented) return;
    e.preventDefault();
    // A read-only note is searched, not replaced in.
    active.editor.chain()[active.editable ? command : 'openFind']().run();
}

/**
 * Centralized keyboard shortcut handler.
 * Shortcuts:
 * - Cmd/Ctrl+K: Open search
 * - Cmd/Ctrl+N: Create new note
 * - Cmd/Ctrl+S: Save current note
 * - Cmd/Ctrl+/: Keyboard shortcuts help
 * - Cmd/Ctrl+Shift+T: Open today's daily note
 * - Cmd/Ctrl+F, Cmd/Ctrl+H (findInNote): Find, Find and replace in the open note
 * - Esc: onEscape, unless something else (a dialog, menu or popup) already handled it
 */
export function useKeyboardShortcuts({
    onSearch,
    onNewNote,
    onSave,
    onKeyboardHelp,
    onFocusMode,
    onDailyNote,
    onEscape,
    findInNote,
}: KeyboardShortcutsConfig) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Radix dialogs/popovers and ProseMirror menus preventDefault the Esc they consume
            if (e.key === 'Escape' && onEscape && !e.defaultPrevented) {
                onEscape();
                return;
            }

            const isMod = e.metaKey || e.ctrlKey;

            if (!isMod) return;

            switch (e.key.toLowerCase()) {
                case 'k':
                    if (onSearch) {
                        e.preventDefault();
                        onSearch();
                    }
                    break;
                case 'n':
                    if (onNewNote) {
                        e.preventDefault();
                        onNewNote();
                    }
                    break;
                case 's':
                    if (onSave) {
                        e.preventDefault();
                        onSave();
                    }
                    break;
                case '/':
                    if (onKeyboardHelp) {
                        e.preventDefault();
                        onKeyboardHelp();
                    }
                    break;
                case 'f':
                    if (e.shiftKey) {
                        if (onFocusMode) {
                            e.preventDefault();
                            onFocusMode();
                        }
                    } else if (findInNote) {
                        openInActiveNote(e, 'openFind');
                    }
                    break;
                case 'h':
                    if (findInNote && !e.shiftKey) openInActiveNote(e, 'openReplace');
                    break;
                case 't':
                    if (e.shiftKey && onDailyNote) {
                        e.preventDefault();
                        onDailyNote();
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onSearch, onNewNote, onSave, onKeyboardHelp, onFocusMode, onDailyNote, onEscape, findInNote]);
}
