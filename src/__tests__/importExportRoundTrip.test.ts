// @vitest-environment happy-dom
/**
 * Export All Notes -> Import Archive gives back the same notes (#672).
 * Real ExportService + ImportService on PGlite; only the payload fetch and the download are stubbed.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import * as Y from 'yjs';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { createTestDatabase, closeTestDatabase } from './testDb';
import {
    saveDocumentUpdate, upsertSearchIndex, createFolder, getAllDocuments, getAllFolders,
    getDocumentUpdates, getPendingImageUploads,
} from '@/lib/db/queries';
import { createDoc, toMarkdown, editorSchema } from '@/lib/agent/editEngine';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';
import type { DocumentMetadata, SearchIndexEntry } from '@/types';
import { FEATURES } from './fixtures/markdownFeatures';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

const { mockGetPayloadBytes } = vi.hoisted(() => ({ mockGetPayloadBytes: vi.fn() }));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return { ...actual, getPayloadBytes: mockGetPayloadBytes };
});

// happy-dom has no createImageBitmap; the ingest itself is covered in imageIngest.test.ts
vi.mock('@/lib/images/imageIngest', () => ({ prepareImageForUpload: async (file: File) => file }));

import { ExportService } from '@/lib/importexport/ExportService';
import { ImportService } from '@/lib/importexport/ImportService';

const CREATED = '2025-03-04T05:06:07.000Z';
const MODIFIED = '2026-01-02T03:04:05.000Z';
const FOLDER_ID = '99999999-9999-9999-9999-999999999999';
const SLASH_FOLDER_ID = '88888888-8888-8888-8888-888888888888';

const PLAIN_BYTES = new Uint8Array([1, 2, 3, 4]);
const GALLERY_BYTES = new Uint8Array([9, 8, 7]);
const GALLERY_BYTES_2 = new Uint8Array([6, 5]);
const PAYLOADS: Record<string, Uint8Array> = {
    'f-images/jrnl_img0': PLAIN_BYTES,
    'f-images/jrnl_img1': GALLERY_BYTES,
    'f-images/jrnl_img2': GALLERY_BYTES_2,
};

interface Seed {
    docId: string;
    title: string;
    markdown: string;
    folderId?: string;
    tags?: string[];
    excludeFromAI?: boolean;
}

const featureSeeds: Seed[] = Object.entries(FEATURES).map(([feature, markdown], i) => ({
    docId: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
    title: `Feature ${feature}`,
    markdown,
}));

const extraSeeds: Seed[] = [
    { docId: 'aaaaaaaa-0000-0000-0000-000000000001', title: 'In a folder', markdown: 'Folder body.', folderId: FOLDER_ID },
    { docId: 'aaaaaaaa-0000-0000-0000-000000000002', title: 'Tagged', markdown: 'Tags.', tags: ['plain', 'a, b', 'say "hi"', 'back\\slash'] },
    { docId: 'aaaaaaaa-0000-0000-0000-000000000003', title: 'He said "hi": a/b', markdown: 'Tricky title.' },
    { docId: 'aaaaaaaa-0000-0000-0000-000000000004', title: 'Private', markdown: 'Keep out of AI.', excludeFromAI: true },
    { docId: 'aaaaaaaa-0000-0000-0000-000000000005', title: 'Slash folder note', markdown: 'In a folder with a slash.', folderId: SLASH_FOLDER_ID },
    { docId: 'aaaaaaaa-0000-0000-0000-000000000006', title: '', markdown: 'No title.' },
    {
        docId: 'aaaaaaaa-0000-0000-0000-000000000007', title: 'Images',
        markdown: 'Before.\n\n![plain](attachment://f-images/jrnl_img0)\n\nMiddle.\n\n<div data-gallery="row">\n\n![One](attachment://f-images/jrnl_img1) ![Two](attachment://f-images/jrnl_img2)\n\n</div>\n\nAfter.',
    },
];

const seeds = [...featureSeeds, ...extraSeeds];
const seedIds = new Set(seeds.map((s) => s.docId));

async function loadDoc(docId: string): Promise<Y.Doc> {
    const doc = new Y.Doc();
    for (const update of await getDocumentUpdates(docId)) Y.applyUpdate(doc, update);
    return doc;
}

function imageNodes(doc: Y.Doc): Record<string, unknown>[] {
    const root = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment('prosemirror'), editorSchema);
    const attrs: Record<string, unknown>[] = [];
    root.descendants((n) => { if (n.type.name === 'image') attrs.push(n.attrs); });
    return attrs;
}

describe('export all -> import the zip (#672)', () => {
    let db: PGlite;
    let imported: SearchIndexEntry[];
    let folders: { id: string; name: string }[];

    const importedFor = (title: string) => imported.find((d) => d.title === title)!;

    beforeAll(async () => {
        db = await createTestDatabase();
        // @ts-expect-error test-only setter
        pgliteModule.setTestDb(db);
        await createFolder(FOLDER_ID, 'Trips');
        await createFolder(SLASH_FOLDER_ID, 'Trips/2026');

        for (const seed of seeds) {
            const doc = createDoc(seed.markdown);
            await saveDocumentUpdate(seed.docId, Y.encodeStateAsUpdate(doc));
            const metadata: DocumentMetadata = {
                title: seed.title,
                folderId: seed.folderId ?? MAIN_FOLDER_ID,
                tags: seed.tags ?? [],
                timestamps: { created: CREATED, modified: MODIFIED },
                excludeFromAI: seed.excludeFromAI ?? false,
            };
            await upsertSearchIndex({ docId: seed.docId, title: seed.title, plainTextContent: '', metadata });
        }
        mockGetPayloadBytes.mockImplementation(async (_c: unknown, _d: unknown, _f: string, ...rest: unknown[]) => {
            const key = `${_f}/${rest[0]}`;
            return { bytes: PAYLOADS[key], contentType: 'image/jpeg' };
        });

        let exported: Blob | undefined;
        let urls = 0;
        vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
            exported ??= obj as Blob;
            return `blob:mock-${urls++}`;
        });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        await ExportService.exportAllAsZip({} as DotYouClient);
        const file = new File([exported!], 'export.zip');
        const result = await ImportService.importFiles([file]);
        expect(result.failed).toBe(0);
        expect(result.imported).toBe(seeds.length);

        imported = (await getAllDocuments()).filter((d) => !seedIds.has(d.docId));
        folders = await getAllFolders();
    });
    afterAll(async () => {
        vi.restoreAllMocks();
        await closeTestDatabase();
    });

    describe('bodies', () => {
        for (const seed of [...featureSeeds, extraSeeds[0]]) {
            it(`${seed.title}: imported markdown equals the original's`, async () => {
                const copy = importedFor(seed.title);
                expect(toMarkdown(await loadDoc(copy.docId))).toBe(toMarkdown(await loadDoc(seed.docId)));
            });
        }
    });

    describe('metadata', () => {
        it('keeps created and modified', () => {
            for (const copy of imported) {
                expect(copy.metadata.timestamps).toEqual({ created: CREATED, modified: MODIFIED });
            }
        });

        it('keeps excludeFromAI, and leaves it off elsewhere', () => {
            expect(importedFor('Private').metadata.excludeFromAI).toBe(true);
            expect(importedFor('Tagged').metadata.excludeFromAI).toBe(false);
        });

        it('keeps tags, including one with a comma, a quote and a backslash', () => {
            expect(importedFor('Tagged').metadata.tags).toEqual(['plain', 'a, b', 'say "hi"', 'back\\slash']);
        });

        it('keeps a title with a quote, a colon and a slash', () => {
            expect(importedFor('He said "hi": a/b').title).toBe('He said "hi": a/b');
        });
    });

    describe('folders', () => {
        it('puts a Main note back in Main', () => {
            expect(importedFor('Tagged').metadata.folderId).toBe(MAIN_FOLDER_ID);
        });

        it('puts a folder note back in its folder, matched by name', () => {
            expect(importedFor('In a folder').metadata.folderId).toBe(FOLDER_ID);
        });

        // Known limit: export writes the folder as a path segment, so "/" becomes "_" (sanitizeFilename)
        // and the note comes back in a new folder with that name.
        it('brings a folder name with "/" back as a new folder with "_"', () => {
            const copy = importedFor('Slash folder note');
            expect(copy.metadata.folderId).not.toBe(SLASH_FOLDER_ID);
            expect(folders.find((f) => f.id === copy.metadata.folderId)?.name).toBe('Trips_2026');
        });
    });

    // Known limit: an empty title has no file name to speak of, so the "Untitled" fallback is the title.
    it('brings an empty title back as "Untitled"', async () => {
        const copy = importedFor('Untitled');
        expect(toMarkdown(await loadDoc(copy.docId))).toBe('No title.');
    });

    describe('attachment images', () => {
        it('come back as pending uploads with the original bytes, in order and in the right note', async () => {
            const copy = importedFor('Images');
            const uploads = await getPendingImageUploads(copy.docId);
            expect(uploads.map((u) => Array.from(u.blobData))).toEqual([
                Array.from(PLAIN_BYTES), Array.from(GALLERY_BYTES), Array.from(GALLERY_BYTES_2),
            ]);

            const nodes = imageNodes(await loadDoc(copy.docId));
            expect(nodes.map((n) => n.alt)).toEqual(['plain', 'One', 'Two']);
            // The queue row stores the id as a uuid; the node keeps it as generated
            expect(nodes.map((n) => String(n['data-pending-id']).replace(/-/g, '')))
                .toEqual(uploads.map((u) => u.id.replace(/-/g, '')));
            for (const n of nodes) expect(String(n.src)).toMatch(/^blob:/);
        });

        it('keep the text around them and the gallery grouping', async () => {
            const md = toMarkdown(await loadDoc(importedFor('Images').docId));
            expect(md).toMatch(/^Before\.\n\n!\[plain\]\(blob:mock-\d+\)\n\nMiddle\.\n\n<div data-gallery="row">/);
            expect(md).toMatch(/!\[One\]\(blob:mock-\d+\) !\[Two\]\(blob:mock-\d+\)\n\n<\/div>\n\nAfter\.$/);
        });

        it('leave no pending uploads on the other notes', async () => {
            expect(await getPendingImageUploads(importedFor('Tagged').docId)).toEqual([]);
        });
    });
});

// Known limit (#593's vault-root rule): when every note sits in one folder and there are no images,
// the zip has one top-level folder, which import reads as a zipped vault's root and strips.
describe('export all -> import, every note in one folder', () => {
    afterAll(async () => {
        vi.restoreAllMocks();
        await closeTestDatabase();
    });

    it('brings the notes back in Main, not in the folder', async () => {
        const db = await createTestDatabase();
        // @ts-expect-error test-only setter
        pgliteModule.setTestDb(db);
        await createFolder(FOLDER_ID, 'Trips');
        const docId = 'bbbbbbbb-0000-0000-0000-000000000001';
        await saveDocumentUpdate(docId, Y.encodeStateAsUpdate(createDoc('Only note.')));
        await upsertSearchIndex({
            docId, title: 'Only note', plainTextContent: '',
            metadata: { title: 'Only note', folderId: FOLDER_ID, tags: [], timestamps: { created: CREATED, modified: MODIFIED }, excludeFromAI: false },
        });
        let exported: Blob | undefined;
        vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
            exported ??= obj as Blob;
            return 'blob:mock';
        });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        await ExportService.exportAllAsZip({} as DotYouClient);
        await ImportService.importFiles([new File([exported!], 'export.zip')]);

        const copy = (await getAllDocuments()).find((d) => d.docId !== docId)!;
        expect(copy.title).toBe('Only note');
        expect(copy.metadata.folderId).toBe(MAIN_FOLDER_ID);
    });
});
