import { useEffect } from 'react';

interface KeyboardShortcutsConfig {
    onSearch?: () => void;
    onNewNote?: () => void;
    onSave?: () => void;
    onKeyboardHelp?: () => void;
    onFocusMode?: () => void;
    onDailyNote?: () => void;
    onEscape?: () => void;
}

/**
 * Centralized keyboard shortcut handler.
 * Shortcuts:
 * - Cmd/Ctrl+K: Open search
 * - Cmd/Ctrl+N: Create new note
 * - Cmd/Ctrl+S: Save current note
 * - Cmd/Ctrl+/: Keyboard shortcuts help
 * - Cmd/Ctrl+Shift+T: Open today's daily note
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
                    if (e.shiftKey && onFocusMode) {
                        e.preventDefault();
                        onFocusMode();
                    }
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
    }, [onSearch, onNewNote, onSave, onKeyboardHelp, onFocusMode, onDailyNote, onEscape]);
}
