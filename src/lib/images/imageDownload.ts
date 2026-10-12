/** Helpers for saving an image's original bytes to disk. */

const EXTENSIONS: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/heic': 'heic',
    'image/heif': 'heif',
};

/** "<alt as a slug or 'image'>.<extension for the content type>" */
export function imageFilename(alt: string, contentType: string): string {
    const base = alt
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    return `${base || 'image'}.${EXTENSIONS[contentType] ?? 'png'}`;
}

export function saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}
