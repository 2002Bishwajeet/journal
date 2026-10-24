import JSZip, { type JSZipObject } from 'jszip';
import { getNewId } from '@/lib/utils';
import { saveDocumentUpdate, upsertSearchIndex, createFolder, getAllFolders, savePendingImageUpload, upsertSyncRecord } from '@/lib/db/queries';
import { prepareImageForUpload } from '@/lib/images/imageIngest';
import { formatGuidId } from '@homebase-id/js-lib/helpers';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { newNoteShareFields } from '@/lib/share/sharedFolder';
import { extractPreviewTextFromYjs } from '@/lib/yjs-utils';
import * as Y from 'yjs';
import type { DocumentMetadata } from '@/types';
import {
    EXPORT_MARKER, IMAGE_TYPES, commonRoot, convertMarkdown, databaseCsvs, databaseTable, dropTitleHeading, folderOf, inlineTags,
    isSkippedPath, parseFrontMatter, resolveImagePath, stripNotionId, titleOf,
} from './markdownImport';

export interface ImportResult {
    imported: number;
    foldersCreated: number;
    failed: number;
    /** Zip entries left out because they are not Markdown, CSV or an image (#595) */
    skipped: number;
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
        const result: ImportResult = { imported: 0, foldersCreated: 0, failed: 0, skipped: 0, errors: [] };

        // Cache existing folders to avoid re-fetching
        const existingFolders = await getAllFolders();
        const folderNameMap = new Map<string, string>(); // Name -> ID
        existingFolders.forEach(f => folderNameMap.set(f.name.toLowerCase(), f.id));
        // Notes imported into a shared folder start public, like any note created there (#618)
        const publicFolderIds = new Set(existingFolders.filter(f => f.isPublic).map(f => f.id));

        for (const file of fileList) {
            try {
                if (file.name.endsWith('.zip')) {
                    await importZip(file, folderNameMap, publicFolderIds, result);
                } else if (file.name.endsWith('.md')) {
                    // A batch of one, dated by the file
                    const source = { path: file.name, text: await file.text(), date: new Date(file.lastModified) };
                    await importNotes([source], new Map(), publicFolderIds, result, async () => MAIN_FOLDER_ID);
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
 * Import a Zip file of Markdown notes, such as a Journal export or a zipped Obsidian vault
 */
async function importZip(
    file: File,
    folderNameMap: Map<string, string>,
    publicFolderIds: ReadonlySet<string>,
    result: ImportResult
): Promise<void> {
    const filesOf = (zip: JSZip) => Object.values(zip.files).filter((entry) => !entry.dir && !isSkippedPath(entry.name));
    const isZip = (entry: JSZipObject) => entry.name.toLowerCase().endsWith('.zip');
    const outer = filesOf(await JSZip.loadAsync(file));
    // A large Notion export is a zip of `…-Part-N.zip` parts: each part joins this batch (one level
    // deep: a zip inside a part is skipped)
    const entries = outer.filter((entry) => !isZip(entry));
    for (const part of outer.filter(isZip)) entries.push(...filesOf(await JSZip.loadAsync(await part.async('uint8array'))));
    // Every file, by its path in the zip: images the notes reference
    const assets = new Map(entries.map((entry) => [entry.name, entry]));
    // A zipped vault has everything under `Vault/`: its top-level folders become Journal folders.
    // A Journal export has the marker at its root, so it has no such root.
    const root = commonRoot(entries.map((entry) => entry.name));
    const databases = new Set(databaseCsvs(entries.map((entry) => entry.name).filter((name) => name.endsWith('.csv'))));

    const sources: SourceNote[] = [];
    for (const entry of entries) {
        if (entry.name === EXPORT_MARKER) continue;
        if (entry.name.endsWith('.md') || databases.has(entry.name)) {
            sources.push({ path: entry.name, text: await entry.async('string'), date: entry.date });
        } else if (!entry.name.endsWith('.csv') && !IMAGE_TYPES[entry.name.split('.').pop()!.toLowerCase()]) {
            result.skipped++;
        }
    }
    await importNotes(sources, assets, publicFolderIds, result,
        (path) => folderIdFor(stripNotionId(folderOf(path, root)), folderNameMap, result));
}

/** The id of the folder named `name` (matched case-insensitively), created if there is none; Main for ''. */
async function folderIdFor(name: string, folderNameMap: Map<string, string>, result: ImportResult): Promise<string> {
    if (!name) return MAIN_FOLDER_ID;
    const existing = folderNameMap.get(name.toLowerCase());
    if (existing) return existing;
    // Dashed, as Postgres returns UUID ids: the note's folderId must match the folder row
    const id = formatGuidId(getNewId());
    await createFolder(id, name);
    await upsertSyncRecord({ localId: id, entityType: 'folder', syncStatus: 'pending' });
    folderNameMap.set(name.toLowerCase(), id);
    result.foldersCreated++;
    return id;
}

/** A Markdown file to import: its path in the zip (or its name), text, and file date. */
interface SourceNote {
    path: string;
    text: string;
    date: Date;
}

/**
 * Imports a batch of notes in two passes: the first gives every note its id, so that
 * links between notes of the batch resolve in the second, which builds and saves them.
 */
async function importNotes(
    sources: readonly SourceNote[],
    assets: Map<string, JSZipObject>,
    publicFolderIds: ReadonlySet<string>,
    result: ImportResult,
    folderFor: (path: string) => Promise<string>
): Promise<void> {
    // Always new ids, to avoid conflicts
    const notes = sources.map(({ path, text, date }) => ({ path, date, id: formatGuidId(getNewId()), ...parseFrontMatter(text) }));
    const files = [...assets.keys()];
    const { createDoc } = await import('@/lib/agent/editEngine');

    for (const note of notes) {
        const folderId = await folderFor(note.path);
        const date = note.date.toISOString();
        // The file name (without a Notion id) when the front-matter has no title
        const title = note.title || titleOf(note.path);
        const database = note.path.endsWith('.csv');
        const content = database ? '' : dropTitleHeading(note.content, title);
        const metadata: DocumentMetadata = {
            title,
            folderId,
            tags: [...new Set([...note.tags, ...inlineTags(content)])],
            timestamps: { created: note.created || date, modified: note.modified || date },
            excludeFromAI: note.excludeFromAI,
            ...newNoteShareFields({ isPublic: publicFolderIds.has(folderId) }),
        };

        // Create Yjs doc, with relative images queued as this note's own uploads
        // A Notion database (CSV) is one note: a table of its rows
        const markdown = database ? databaseTable(note.content, note.path, notes) : convertMarkdown(content, note.path, notes, files);
        const images = await queueImportedImages(markdown, note.path, assets, note.id);
        const doc = createDoc(images.markdown);
        markPendingImages(doc.getXmlFragment('prosemirror'), images.pendingIds);
        const updateBlob = Y.encodeStateAsUpdate(doc);

        // Save to DB
        await saveDocumentUpdate(note.id, updateBlob);
        await upsertSearchIndex({
            docId: note.id,
            title: metadata.title,
            // From the built note, so the list preview and search read text, not markdown syntax
            plainTextContent: await extractPreviewTextFromYjs(note.id, updateBlob),
            metadata
        });
        await upsertSyncRecord({ localId: note.id, entityType: 'note', syncStatus: 'pending' });

        result.imported++;
    }
}

// ![alt](target "title"); the target may hold spaces, as export writes titles into asset names
const MD_IMAGE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^)]*?)(\s+"[^"]*")?\s*\)/g;
// <img src="target" ...>, how a sized or aligned image is written (#581); its attributes are HTML-escaped
const HTML_IMAGE = /<img\s[^>]*?\bsrc="([^"]*)"[^>]*>/g;
const unescapeAttr = (v: string) => v.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// FileHandler's paste/drop limit
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

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
    const targets = [
        ...Array.from(markdown.matchAll(MD_IMAGE), (m) => m[2]),
        ...Array.from(markdown.matchAll(HTML_IMAGE), (m) => unescapeAttr(m[1])),
    ];
    for (const target of targets) {
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
    }).replace(HTML_IMAGE, (full, target: string) => {
        const path = resolveImagePath(notePath, unescapeAttr(target));
        if (path === null) return full;
        const image = queued.get(path);
        if (!image) return unescapeAttr(full.match(/\balt="([^"]*)"/)?.[1] ?? '') || path;
        pendingIds.set(image.src, image.pendingId);
        return full.replace(`src="${target}"`, `src="${image.src}"`);
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
