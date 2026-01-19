import JSZip from 'jszip';
import { getNewId } from '@/lib/utils';
import { saveDocumentUpdate, upsertSearchIndex, createFolder, getAllFolders } from '@/lib/db/queries';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import * as Y from 'yjs';
import type { DocumentMetadata } from '@/types';

export interface ImportResult {
    imported: number;
    foldersCreated: number;
    failed: number;
    errors: string[];
}

/**
 * Service to handle importing notes and zip archives
 */
export const ImportService = {
    /**
     * Import files (Markdown or Zip)
     */
    async importFiles(fileList: FileList): Promise<ImportResult> {
        const result: ImportResult = { imported: 0, foldersCreated: 0, failed: 0, errors: [] };

        // Cache existing folders to avoid re-fetching
        const existingFolders = await getAllFolders();
        const folderNameMap = new Map<string, string>(); // Name -> ID
        existingFolders.forEach(f => folderNameMap.set(f.name.toLowerCase(), f.id));

        for (const file of fileList) {
            try {
                if (file.name.endsWith('.zip')) {
                    await importZip(file, folderNameMap, result);
                } else if (file.name.endsWith('.md')) {
                    await importMarkdown(file, MAIN_FOLDER_ID, result);
                } else {
                    // Skip unsupported files without erroring the whole batch
                    console.warn(`Skipping unsupported file: ${file.name}`);
                }
            } catch (error) {
                console.error(`Error importing ${file.name}:`, error);
                result.failed++;
                result.errors.push(`Failed to import ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        return result;
    }
};

/**
 * Import a Zip file containing Markdown notes and folders
 */
async function importZip(
    file: File,
    folderNameMap: Map<string, string>,
    result: ImportResult
): Promise<void> {
    const zip = await JSZip.loadAsync(file);

    // Iterate through all files in the zip
    // We use Promise.all to handle them, but sequentially might be safer for DB if massive
    // For now, simple iteration
    const entries = Object.keys(zip.files);

    for (const filename of entries) {
        const entry = zip.files[filename];

        if (entry.dir) continue; // Skip directory entries themselves
        if (!filename.endsWith('.md')) continue; // Skip non-markdown files
        if (filename.startsWith('__MACOSX') || filename.includes('.DS_Store')) continue; // Skip system files

        // Determine folder from path
        // Structure: "FolderName/NoteName.md" or "NoteName.md"
        const parts = filename.split('/');
        let folderId = MAIN_FOLDER_ID;

        if (parts.length > 1) {
            // It's inside a folder
            const folderName = parts[0];
            // Check if we need to create it
            const normalizedName = folderName.toLowerCase();

            if (folderNameMap.has(normalizedName)) {
                folderId = folderNameMap.get(normalizedName)!;
            } else {
                // Create new folder
                const newFolderId = getNewId();
                await createFolder(newFolderId, folderName);
                folderNameMap.set(normalizedName, newFolderId);
                folderId = newFolderId;
                result.foldersCreated++;
            }
        }

        const content = await entry.async('string');
        const fileObj = new File([content], parts[parts.length - 1], { type: 'text/markdown' });

        await importMarkdown(fileObj, folderId, result);
    }
}

/**
 * Import a single Markdown file into a specific folder
 */
async function importMarkdown(
    file: File,
    targetFolderId: string,
    result: ImportResult
): Promise<void> {
    const text = await file.text();
    const { metadata, content } = parseMarkdown(text);

    // Override folderId with target
    metadata.folderId = targetFolderId;
    // Update timestamps if missing
    if (!metadata.timestamps.created) {
        metadata.timestamps.created = new Date().toISOString();
        metadata.timestamps.modified = new Date().toISOString();
    }

    // Use filename as title if none in frontmatter (fallback)
    if (!metadata.title) {
        metadata.title = file.name.replace(/\.md$/, '');
    }

    // Always create new ID to avoid conflicts
    const docId = getNewId();

    // Create Yjs doc
    const doc = new Y.Doc();
    const xmlFragment = doc.getXmlFragment('prosemirror');
    const paragraph = new Y.XmlElement('paragraph');
    paragraph.insert(0, [new Y.XmlText(content)]);
    xmlFragment.push([paragraph]);
    const updateBlob = Y.encodeStateAsUpdate(doc);

    // Save to DB
    await saveDocumentUpdate(docId, updateBlob);
    await upsertSearchIndex({
        docId,
        title: metadata.title,
        plainTextContent: content,
        metadata
    });

    result.imported++;
}

/**
 * Parse Markdown with Frontmatter
 */
function parseMarkdown(text: string): { metadata: DocumentMetadata; content: string } {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = text.match(frontmatterRegex);

    const now = new Date().toISOString();
    const metadata: DocumentMetadata = {
        title: '',
        folderId: MAIN_FOLDER_ID,
        tags: [],
        timestamps: { created: now, modified: now },
        excludeFromAI: false
    };

    let content = text;

    if (match) {
        // Parse frontmatter
        const frontmatterBlock = match[1];
        content = text.slice(match[0].length); // Remove frontmatter from content

        // Simple line parser for YAML-like syntax
        const lines = frontmatterBlock.split('\n');
        for (const line of lines) {
            const parts = line.split(':');
            if (parts.length < 2) continue;

            const key = parts[0].trim();
            const value = parts.slice(1).join(':').trim(); // Rejoin in case value has colons (like dates)

            // Handle quotes
            const cleanValue = value.replace(/^["']|["']$/g, '');

            if (key === 'title') metadata.title = cleanValue;
            if (key === 'created') metadata.timestamps.created = cleanValue;
            if (key === 'modified') metadata.timestamps.modified = cleanValue;
            if (key === 'excludeFromAI') metadata.excludeFromAI = cleanValue === 'true';

            if (key === 'tags') {
                // Remove brackets and split
                // [tag1, tag2]
                const cleanTags = value.replace(/^\[|\]$/g, '');
                metadata.tags = cleanTags.split(',').map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
            }
        }
    }

    return { metadata, content: content.trim() };
}
