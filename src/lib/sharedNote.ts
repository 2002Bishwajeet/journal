/**
 * The note a share makes (the share target, the macOS Services menu): the shared title or
 * "Shared Note", and the text with the url under it.
 */
export function sharedNote({ title, text, url }: { title?: string | null; text?: string | null; url?: string | null }): {
    title: string;
    content: string;
} {
    const body = text && url ? `${text}\n\n${url}` : text || url || '';
    return { title: title || 'Shared Note', content: body };
}
