import { useEffect } from 'react';

interface KeyboardShortcutsConfig {
    onSearch?: () => void;
    onNewNote?: () => void;
    onSave?: () => void;
    onKeyboardHelp?: () => void;
}

/**
 * Centralized keyboard shortcut handler.
 * Shortcuts:
 * - Cmd/Ctrl+K: Open search
 * - Cmd/Ctrl+N: Create new note
 * - Cmd/Ctrl+S: Save current note
 * - Cmd/Ctrl+/: Keyboard shortcuts help
 */
export function useKeyboardShortcuts({
    onSearch,
    onNewNote,
    onSave,
    onKeyboardHelp,
}: KeyboardShortcutsConfig) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
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
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onSearch, onNewNote, onSave, onKeyboardHelp]);
}
