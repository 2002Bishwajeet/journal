/**
 * ProseMirror calls preventDefault() on every Escape that reaches the editor, so the window-level
 * Esc handler cannot tell a spare Escape from one a popup consumed. The editor's own keymap runs
 * last, after the suggestion menus, autocomplete and Find, and announces the Escape nobody used (#1391).
 */
export const EDITOR_ESCAPE_EVENT = 'journal:editor-escape';
