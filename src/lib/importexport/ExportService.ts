import JSZip from 'jszip';
import { getPayloadBytes, type DotYouClient } from '@homebase-id/js-lib/core';
import { getAllDocuments, getAllFolders } from '@/lib/db/queries';
import { JOURNAL_DRIVE, MAIN_FOLDER_ID } from '@/lib/homebase';
import { extractMarkdownFromYjs } from '@/lib/yjs-utils';
import type { SearchIndexEntry } from '@/types';

/**
 * Result of the export operation
 */
export interface ExportResult {
    success: boolean;
    count: number;
    size: number; // in bytes
    filename: string;
    missingImages: number;
}

// ![alt](attachment://fileId/payloadKey) — matches what extractMarkdownFromYjs emits
// for a synced image.
const ATTACHMENT_IMAGE_REGEX = /!\[([^\]]*)\]\(attachment:\/\/([^/)\s]+)\/([^)\s]+)\)/g;
// ![alt](blob:...) — a pending (not-yet-uploaded) image. Its bytes are local only;
// exporting them is out of scope for #183, so they're just counted as missing.
const BLOB_IMAGE_REGEX = /!\[([^\]]*)\]\(blob:[^)\s]+\)/g;

/**
 * Service to handle exporting notes and folders
 */
export const ExportService = {
    /**
     * Export all notes and folders as a ZIP file
     * Structure:
     * - Root/
     *   - Note2.md
     *   - assets/
     *     - Note2-jrnl_img0.jpg
     *   - Folder A/
     *     - Note1.md
     *     - assets/
     *       - Note1-jrnl_img0.jpg
     */
    async exportAllAsZip(dotYouClient: DotYouClient): Promise<ExportResult> {
        try {
            const zip = new JSZip();
            const notes = await getAllDocuments();
            const folders = await getAllFolders();

            // Create a map of folder IDs to names for quick lookup
            const folderMap = new Map<string, string>();
            folders.forEach(f => folderMap.set(f.id, f.name));

            let count = 0;
            let missingImages = 0;

            for (const note of notes) {
                // Determine path based on folder
                let folderName = '';
                if (note.metadata.folderId && note.metadata.folderId !== MAIN_FOLDER_ID) {
                    const name = folderMap.get(note.metadata.folderId);
                    if (name) {
                        folderName = sanitizeFilename(name);
                    }
                }

                const sanitizedTitle = sanitizeFilename(note.title || 'Untitled');
                const body = await extractMarkdownFromYjs(note.docId);
                const images = await resolveNoteImages(body, dotYouClient, sanitizedTitle, zip, folderName);
                missingImages += images.missingImages;

                // Generate Markdown content
                const markdownContent = generateMarkdown(note, images.markdown);
                const filename = `${sanitizedTitle}.md`;

                // Add to zip
                if (folderName) {
                    zip.folder(folderName)?.file(filename, markdownContent);
                } else {
                    zip.file(filename, markdownContent);
                }

                count++;
            }

            // Generate zip blob
            const blob = await zip.generateAsync({ type: 'blob' });

            // Trigger download
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const downloadFilename = `journal-export-${timestamp}.zip`;
            downloadBlob(blob, downloadFilename);

            return {
                success: true,
                count,
                size: blob.size,
                filename: downloadFilename,
                missingImages,
            };
        } catch (error) {
            console.error('Export failed:', error);
            throw error;
        }
    }
};

/**
 * Fetches every attachment:// image referenced in a note's markdown, writes it to
 * <folder>/assets/<title>-<payloadKey>.<ext> in the zip, and rewrites the link to
 * that relative path. A fetch failure (offline, 404) leaves the original link and
 * counts the image as missing. Repeated refs to the same fileId/payloadKey within
 * the note are only fetched once. blob: (pending upload) links are left as-is and
 * also counted as missing — exporting local pending images is out of scope for #183.
 */
async function resolveNoteImages(
    markdown: string,
    dotYouClient: DotYouClient,
    sanitizedTitle: string,
    zip: JSZip,
    folderName: string
): Promise<{ markdown: string; missingImages: number }> {
    const resolved = new Map<string, string | null>(); // "fileId/payloadKey" -> asset filename, or null if it failed
    let missingImages = 0;

    for (const [, , fileId, payloadKey] of markdown.matchAll(ATTACHMENT_IMAGE_REGEX)) {
        const cacheKey = `${fileId}/${payloadKey}`;
        if (resolved.has(cacheKey)) continue;

        try {
            const payload = await getPayloadBytes(dotYouClient, JOURNAL_DRIVE, fileId, payloadKey, { decrypt: true });
            if (!payload) throw new Error('No payload returned');

            const assetFilename = `${sanitizedTitle}-${payloadKey}.${extensionForContentType(payload.contentType)}`;
            const assetPath = folderName ? `${folderName}/assets/${assetFilename}` : `assets/${assetFilename}`;
            zip.file(assetPath, payload.bytes);
            resolved.set(cacheKey, assetFilename);
        } catch (error) {
            console.error(`Failed to export image ${cacheKey}:`, error);
            resolved.set(cacheKey, null);
            missingImages++;
        }
    }

    const rewritten = markdown.replace(ATTACHMENT_IMAGE_REGEX, (full, alt, fileId, payloadKey) => {
        const assetFilename = resolved.get(`${fileId}/${payloadKey}`);
        return assetFilename ? `![${alt}](assets/${assetFilename})` : full;
    });

    missingImages += rewritten.match(BLOB_IMAGE_REGEX)?.length ?? 0;

    return { markdown: rewritten, missingImages };
}

/** jpeg -> jpg; png/gif/webp pass through; anything else falls back to a generic extension. */
function extensionForContentType(contentType: string): string {
    const subtype = contentType.split('/')[1]?.toLowerCase();
    if (subtype === 'jpeg') return 'jpg';
    if (subtype === 'png' || subtype === 'gif' || subtype === 'webp') return subtype;
    return 'bin';
}

/**
 * Generate Markdown content with Frontmatter
 */
function generateMarkdown(note: SearchIndexEntry, body: string): string {
    const frontmatter = [
        '---',
        `title: "${note.title.replace(/"/g, '\\"')}"`,
        `created: "${note.metadata.timestamps.created}"`,
        `modified: "${note.metadata.timestamps.modified}"`,
    ];

    if (note.metadata.tags && note.metadata.tags.length > 0) {
        frontmatter.push(`tags: [${note.metadata.tags.map(t => `"${t}"`).join(', ')}]`);
    }

    if (note.metadata.excludeFromAI) {
        frontmatter.push('excludeFromAI: true');
    }

    frontmatter.push('---');
    frontmatter.push('');

    return `${frontmatter.join('\n')}\n${body || ''}`;
}

/**
 * Sanitize filename to remove invalid characters
 */
function sanitizeFilename(name: string): string {
    // Remove characters that act as path separators or are invalid in most filesystems
    return name.replace(/[<>:"/\\|?*]/g, '_').trim();
}

/**
 * Trigger browser download for a Blob
 */
function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
