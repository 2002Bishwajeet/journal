import JSZip, { type JSZipObject } from 'jszip';
import { getNewId } from '@/lib/utils';
import { saveDocumentUpdate, upsertSearchIndex, createFolder, getAllFolders, savePendingImageUpload, upsertSyncRecord } from '@/lib/db/queries';
import { prepareImageForUpload } from '@/lib/images/imageIngest';
import { formatGuidId } from '@homebase-id/js-lib/helpers';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { extractPreviewTextFromYjs } from '@/lib/yjs-utils';
import * as Y from 'yjs';
import type { DocumentMetadata } from '@/types';

export interface ImportResult {
    imported: number;
    foldersCreated: number;
    failed: number;
    errors: { file: string; message: string }[];
}

/**
 * Service to handle importing notes and zip archives
 */
export const ImportService = {
    /**
     * Import files (Markdown or Zip)
     */
    async importFiles(fileList: Iterable<File>): Promise<ImportResult> {
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
                    result.failed++;
                    result.errors.push({ file: file.name, message: 'Unsupported file type' });
                }
            } catch (error) {
                console.error(`Error importing ${file.name}:`, error);
                result.failed++;
                result.errors.push({ file: file.name, message: error instanceof Error ? error.message : String(error) });
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
    // Every other file, by its path in the zip: images the notes reference relatively
    const assets = new Map(entries.filter(name => !zip.files[name].dir).map(name => [name, zip.files[name]]));

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

            const existingFolderId = folderNameMap.get(normalizedName);
            if (existingFolderId) {
                folderId = existingFolderId;
            } else {
                // Create new folder
                // Dashed, as Postgres returns UUID ids: the note's folderId must match the folder row
                const newFolderId = formatGuidId(getNewId());
                await createFolder(newFolderId, folderName);
                await upsertSyncRecord({ localId: newFolderId, entityType: 'folder', syncStatus: 'pending' });
                folderNameMap.set(normalizedName, newFolderId);
                folderId = newFolderId;
                result.foldersCreated++;
            }
        }

        const content = await entry.async('string');
        const fileObj = new File([content], parts[parts.length - 1], { type: 'text/markdown' });

        await importMarkdown(fileObj, folderId, result, { path: filename, assets });
    }
}

/**
 * Import a single Markdown file into a specific folder
 */
async function importMarkdown(
    file: File,
    targetFolderId: string,
    result: ImportResult,
    // Where the note sits in its zip, and the zip's files; a loose .md has neither
    source: { path: string; assets: Map<string, JSZipObject> } = { path: file.name, assets: new Map() }
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
    const docId = formatGuidId(getNewId());

    // Create Yjs doc, with relative images queued as this note's own uploads
    const { createDoc } = await import('@/lib/agent/editEngine');
    const images = await queueImportedImages(content, source.path, source.assets, docId);
    const doc = createDoc(images.markdown);
    markPendingImages(doc.getXmlFragment('prosemirror'), images.pendingIds);
    const updateBlob = Y.encodeStateAsUpdate(doc);

    // Save to DB
    await saveDocumentUpdate(docId, updateBlob);
    await upsertSearchIndex({
        docId,
        title: metadata.title,
        // From the built note, so the list preview and search read text, not markdown syntax
        plainTextContent: await extractPreviewTextFromYjs(docId, updateBlob),
        metadata
    });
    await upsertSyncRecord({ localId: docId, entityType: 'note', syncStatus: 'pending' });

    result.imported++;
}

// ![alt](target "title"); the target may hold spaces, as export writes titles into asset names
const MD_IMAGE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^)]*?)(\s+"[^"]*")?\s*\)/g;

// The types the editor accepts on paste/drop (FileHandler), by file extension
const IMAGE_TYPES: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
};
// FileHandler's paste/drop limit
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * The zip path an image target points at, relative to the note at `notePath`;
 * null for a URL (http:, data:, attachment:, ...), which stays as it is.
 */
export function resolveImagePath(notePath: string, target: string): string | null {
    const src = target.replace(/^<|>$/g, '').replace(/[?#].*$/, '');
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return null;
    let decoded = src;
    try { decoded = decodeURIComponent(src); } catch { /* keep the raw path */ }
    const parts = decoded.startsWith('/') ? [] : notePath.split('/').slice(0, -1);
    for (const segment of decoded.split('/')) {
        if (segment === '..') parts.pop();
        else if (segment && segment !== '.') parts.push(segment);
    }
    return parts.join('/');
}

/** Ingests and queues one image as the paste/drop path does; null if it can't be used. */
async function queueImage(entry: JSZipObject | undefined, docId: string): Promise<{ src: string; pendingId: string } | null> {
    const type = entry && IMAGE_TYPES[entry.name.split('.').pop()!.toLowerCase()];
    if (!entry || !type) return null;
    try {
        const file = await prepareImageForUpload(new File([await entry.async('blob')], entry.name, { type }));
        if (file.size > MAX_IMAGE_BYTES) return null;
        const pendingId = getNewId();
        await savePendingImageUpload({
            id: pendingId,
            noteDocId: docId,
            blobData: new Uint8Array(await file.arrayBuffer()),
            contentType: file.type,
            status: 'pending',
            retryCount: 0,
            createdAt: new Date().toISOString(),
        });
        return { src: URL.createObjectURL(file), pendingId };
    } catch (error) {
        console.warn(`Could not import image ${entry.name}:`, error);
        return null;
    }
}

/**
 * Queues every relative image the zip holds as a pending upload of the note and
 * points its link at the queued bytes (a blob: URL, as paste does). A relative
 * image that isn't in the zip becomes its alt text (or its path), not a broken image.
 */
async function queueImportedImages(
    markdown: string,
    notePath: string,
    assets: Map<string, JSZipObject>,
    docId: string
): Promise<{ markdown: string; pendingIds: Map<string, string> }> {
    const queued = new Map<string, { src: string; pendingId: string } | null>(); // zip path -> queued image
    for (const [, , target] of markdown.matchAll(MD_IMAGE)) {
        const path = resolveImagePath(notePath, target);
        if (path !== null && !queued.has(path)) queued.set(path, await queueImage(assets.get(path), docId));
    }

    const pendingIds = new Map<string, string>(); // blob: src -> pending id
    const rewritten = markdown.replace(MD_IMAGE, (full, alt: string, target: string, title = '') => {
        const path = resolveImagePath(notePath, target);
        if (path === null) return full;
        const image = queued.get(path);
        if (!image) return alt || path;
        pendingIds.set(image.src, image.pendingId);
        return `![${alt}](${image.src}${title})`;
    });
    return { markdown: rewritten, pendingIds };
}

/** Tags each queued image node with its pending id, the attr FileHandler sets on paste. */
function markPendingImages(node: Y.XmlFragment | Y.XmlElement, pendingIds: Map<string, string>): void {
    if (node instanceof Y.XmlElement && node.nodeName === 'image') {
        const pendingId = pendingIds.get(node.getAttribute('src') as string);
        if (pendingId) node.setAttribute('data-pending-id', pendingId);
    }
    for (let i = 0; i < node.length; i++) {
        const child = node.get(i);
        if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) markPendingImages(child, pendingIds);
    }
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
