/**
 * Shared Toolbar State Hook
 * 
 * Provides editor formatting state with proper guards for view availability.
 * Used by both EditorToolbar (desktop) and MobileToolbar (mobile).
 */

import { Editor, useEditorState } from '@tiptap/react';

export interface ToolbarState {
    isBold: boolean;
    isItalic: boolean;
    isStrike: boolean;
    isCode: boolean;
    isHeading1: boolean;
    isHeading2: boolean;
    isHeading3: boolean;
    isBulletList: boolean;
    isOrderedList: boolean;
    isTaskList: boolean;
    isBlockquote: boolean;
    isLink: boolean;
    linkHref: string;
}

const defaultState: ToolbarState = {
    isBold: false,
    isItalic: false,
    isStrike: false,
    isCode: false,
    isHeading1: false,
    isHeading2: false,
    isHeading3: false,
    isBulletList: false,
    isOrderedList: false,
    isTaskList: false,
    isBlockquote: false,
    isLink: false,
    linkHref: '',
};

/**
 * Hook to get the current toolbar state from the editor.
 * Returns default false values when editor view is not available.
 */
export function useToolbarState(editor: Editor): ToolbarState {
    return useEditorState({
        editor,
        selector: ({ editor: ed }): ToolbarState => {
            // Guard against editor view not being available yet
            if (!ed.view || ed.isDestroyed) {
                return defaultState;
            }
            return {
                isBold: ed.isActive('bold'),
                isItalic: ed.isActive('italic'),
                isStrike: ed.isActive('strike'),
                isCode: ed.isActive('code'),
                isHeading1: ed.isActive('heading', { level: 1 }),
                isHeading2: ed.isActive('heading', { level: 2 }),
                isHeading3: ed.isActive('heading', { level: 3 }),
                isBulletList: ed.isActive('bulletList'),
                isOrderedList: ed.isActive('orderedList'),
                isTaskList: ed.isActive('taskList'),
                isBlockquote: ed.isActive('blockquote'),
                isLink: ed.isActive('link'),
                linkHref: ed.getAttributes('link').href as string || '',
            };
        },
    });
}

/**
 * Helper to safely run an editor command.
 * Returns early if editor view is not available.
 */
export function safeEditorCommand(editor: Editor, command: () => void): void {
    if (!editor.view || editor.isDestroyed) return;
    command();
}
