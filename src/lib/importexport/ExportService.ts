import JSZip from 'jszip';
import { getAllDocuments, getAllFolders } from '@/lib/db/queries';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import type { SearchIndexEntry } from '@/types';

/**
 * Result of the export operation
 */
export interface ExportResult {
    success: boolean;
    count: number;
    size: number; // in bytes
    filename: string;
}

/**
 * Service to handle exporting notes and folders
 */
export const ExportService = {
    /**
     * Export all notes and folders as a ZIP file
     * Structure:
     * - Root/
     *   - Note2.md
     *   - Folder A/
     *     - Note1.md
     */
    async exportAllAsZip(): Promise<ExportResult> {
        try {
            const zip = new JSZip();
            const notes = await getAllDocuments();
            const folders = await getAllFolders();

            // Create a map of folder IDs to names for quick lookup
            const folderMap = new Map<string, string>();
            folders.forEach(f => folderMap.set(f.id, f.name));

            let count = 0;

            for (const note of notes) {
                // Determine path based on folder
                let folderName = '';
                if (note.metadata.folderId && note.metadata.folderId !== MAIN_FOLDER_ID) {
                    const name = folderMap.get(note.metadata.folderId);
                    if (name) {
                        folderName = sanitizeFilename(name);
                    }
                }

                // Generate Markdown content
                const markdownContent = generateMarkdown(note);
                const filename = `${sanitizeFilename(note.title || 'Untitled')}.md`;

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
                filename: downloadFilename
            };
        } catch (error) {
            console.error('Export failed:', error);
            throw error;
        }
    }
};

/**
 * Generate Markdown content with Frontmatter
 */
function generateMarkdown(note: SearchIndexEntry): string {
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

    return `${frontmatter.join('\n')}\n${note.plainTextContent || ''}`;
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
