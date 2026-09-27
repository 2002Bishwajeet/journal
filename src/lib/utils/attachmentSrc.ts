/**
 * Parse an `attachment://<fileId>/<payloadKey>` image src, scoped to the note
 * currently being rendered. Returns null for any other scheme (blob:, https:,
 * data:, …) and — critically — for a ref whose fileId doesn't match the note:
 * a copy/pasted image keeps the src of the note it came from, and on a public
 * share page that ref must not be followed, since it may point at a private file.
 */
export function parseAttachmentSrc(
    src: string,
    noteFileId: string
): { fileId: string; payloadKey: string } | null {
    if (!src.startsWith('attachment://')) return null;

    const [fileId, payloadKey] = src.replace('attachment://', '').split('/');
    if (!fileId || !payloadKey) return null;
    if (fileId !== noteFileId) return null;

    return { fileId, payloadKey };
}
