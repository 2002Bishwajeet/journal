/**
 * Returns `base`, or `base (2)`, `base (3)`... when `base` is already in `taken`
 * (compared case-insensitively, since macOS and Windows unzip into case-insensitive
 * file systems). The returned name is added to `taken`.
 */
export function uniqueName(taken: Set<string>, base: string): string {
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
    taken.add(name.toLowerCase());
    return name;
}

/**
 * Sanitize filename to remove invalid characters
 */
export function sanitizeFilename(name: string): string {
    // Remove characters that act as path separators or are invalid in most filesystems
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}
