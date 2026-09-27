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
