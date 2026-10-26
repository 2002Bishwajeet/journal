/**
 * Which single pane mobile/tablet shows for a route. A tag filter (`/?tag=x`)
 * has no folder but still shows the note list.
 */
export function getMobilePane({
    folderId,
    noteId,
    tag,
}: {
    folderId?: string;
    noteId?: string;
    tag?: string | null;
}): 'sidebar' | 'list' | 'editor' {
    if (noteId) return 'editor';
    if (folderId || tag) return 'list';
    return 'sidebar';
}

/**
 * The phone's New note button (#878) shows on home and on a note list (not Trash
 * or Archive), and hides while a sheet or dialog is open or a text field has focus.
 */
export function showNewNoteFab({
    isPhone,
    pane,
    isManagementView,
    overlayOpen,
    textFieldFocused,
}: {
    isPhone: boolean;
    pane: 'sidebar' | 'list' | 'editor';
    isManagementView: boolean;
    overlayOpen: boolean;
    textFieldFocused: boolean;
}): boolean {
    if (!isPhone || overlayOpen || textFieldFocused) return false;
    return pane === 'sidebar' || (pane === 'list' && !isManagementView);
}
