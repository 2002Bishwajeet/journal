// @vitest-environment happy-dom
/**
 * Import/Export Integration Tests
 *
 * Tests the import parsing logic (not the file operations).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import * as Y from 'yjs';
import JSZip from 'jszip';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { saveDocumentUpdate, upsertSearchIndex, getAllDocuments, getDocumentUpdates, getPendingImageUploads } from '@/lib/db/queries';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { editorSchema } from '@/lib/agent/editEngine';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';
import type { DocumentMetadata } from '@/types';

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

import { ExportService, uniqueName } from '@/lib/importexport/ExportService';
import { ImportService } from '@/lib/importexport/ImportService';

// ============================================
// ExportService.exportAllAsZip (real markdown + images)
// ============================================
describe('ExportService.exportAllAsZip', () => {
    const DOC_ID = '11111111-1111-1111-1111-111111111111';
    const fakeDotYouClient = {} as DotYouClient;

    const META = (): DocumentMetadata => ({
        title: 'My Note',
        folderId: MAIN_FOLDER_ID,
        tags: [],
        timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
        excludeFromAI: false,
    });

    // A paragraph with bold text followed by an attachment:// image, stored as
    // Yjs document_updates the same way extractMarkdownFromYjs reads them back.
    function noteBlob(fileId: string, payloadKey: string, layout: Record<string, string> = {}): Uint8Array {
        const doc = new Y.Doc();
        const frag = doc.getXmlFragment('prosemirror');
        const p = new Y.XmlElement('paragraph');
        const t = new Y.XmlText();
        t.insert(0, 'bold');
        t.format(0, 4, { bold: true });
        const img = new Y.XmlElement('image');
        img.setAttribute('src', `attachment://${fileId}/${payloadKey}`);
        img.setAttribute('alt', 'a');
        for (const [k, v] of Object.entries(layout)) img.setAttribute(k, v);
        p.insert(0, [t, img]);
        frag.insert(0, [p]);
        const update = Y.encodeStateAsUpdate(doc);
        doc.destroy();
        return update;
    }

    let db: PGlite;
    beforeAll(async () => {
        db = await createTestDatabase();
        // @ts-expect-error test-only setter
        pgliteModule.setTestDb(db);
    });
    afterAll(async () => { await closeTestDatabase(); });

    let capturedBlob: Blob | undefined;
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        capturedBlob = undefined;
        vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
            capturedBlob = obj as Blob;
            return 'blob:mock-url';
        });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    async function exportedZip(dotYouClient: DotYouClient) {
        const result = await ExportService.exportAllAsZip(dotYouClient);
        const buffer = await capturedBlob!.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);
        return { result, zip };
    }

    it('exports real markdown and rewrites an attachment image to a relative asset path bundled in the zip', async () => {
        await saveDocumentUpdate(DOC_ID, noteBlob('remote-file-1', 'jrnl_img0'));
        await upsertSearchIndex({ docId: DOC_ID, title: 'My Note', plainTextContent: 'bold', metadata: META() });
        mockGetPayloadBytes.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' });

        const { result, zip } = await exportedZip(fakeDotYouClient);

        expect(result.missingImages).toBe(0);
        const md = await zip.file('My Note.md')!.async('string');
        expect(md).toContain('**bold**');
        expect(md).toContain('![a](assets/My Note-jrnl_img0.jpg)');
        expect(zip.file('assets/My Note-jrnl_img0.jpg')).not.toBeNull();
    });

    it('keeps the attachment:// link and counts a missing image when the fetch fails', async () => {
        await saveDocumentUpdate(DOC_ID, noteBlob('remote-file-1', 'jrnl_img0'));
        await upsertSearchIndex({ docId: DOC_ID, title: 'My Note', plainTextContent: 'bold', metadata: META() });
        mockGetPayloadBytes.mockRejectedValue(new Error('404'));

        const { result, zip } = await exportedZip(fakeDotYouClient);

        expect(result.missingImages).toBe(1);
        const md = await zip.file('My Note.md')!.async('string');
        expect(md).toContain('![a](attachment://remote-file-1/jrnl_img0)');
    });

    // #581: a sized or aligned image is written as <img src alt width data-align>
    it('bundles a sized, aligned image and rewrites its <img> src to the asset path', async () => {
        await saveDocumentUpdate(DOC_ID, noteBlob('remote-file-1', 'jrnl_img0', { width: '320', align: 'right' }));
        await upsertSearchIndex({ docId: DOC_ID, title: 'My Note', plainTextContent: 'bold', metadata: META() });
        mockGetPayloadBytes.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' });

        const { result, zip } = await exportedZip(fakeDotYouClient);

        expect(result.missingImages).toBe(0);
        const md = await zip.file('My Note.md')!.async('string');
        expect(md).toContain('<img src="assets/My Note-jrnl_img0.jpg" alt="a" width="320" data-align="right">');
        expect(zip.file('assets/My Note-jrnl_img0.jpg')).not.toBeNull();
    });

    it('keeps the <img> attachment:// src and counts a missing sized image when the fetch fails', async () => {
        await saveDocumentUpdate(DOC_ID, noteBlob('remote-file-1', 'jrnl_img0', { width: '320' }));
        await upsertSearchIndex({ docId: DOC_ID, title: 'My Note', plainTextContent: 'bold', metadata: META() });
        mockGetPayloadBytes.mockRejectedValue(new Error('404'));

        const { result, zip } = await exportedZip(fakeDotYouClient);

        expect(result.missingImages).toBe(1);
        const md = await zip.file('My Note.md')!.async('string');
        expect(md).toContain('<img src="attachment://remote-file-1/jrnl_img0" alt="a" width="320">');
    });

    it('round-trips a sized, aligned image through export and import', async () => {
        await saveDocumentUpdate(DOC_ID, noteBlob('remote-file-1', 'jrnl_img0', { width: '320', align: 'right' }));
        await upsertSearchIndex({ docId: DOC_ID, title: 'My Note', plainTextContent: 'bold', metadata: META() });
        mockGetPayloadBytes.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' });
        const { zip } = await exportedZip(fakeDotYouClient);

        const file = new File([await zip.generateAsync({ type: 'blob' })], 'export.zip');
        expect((await ImportService.importFiles([file])).imported).toBe(1);

        const imported = (await getAllDocuments()).find((d) => d.docId !== DOC_ID)!;
        const ydoc = new Y.Doc();
        for (const update of await getDocumentUpdates(imported.docId)) Y.applyUpdate(ydoc, update);
        const root = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment('prosemirror'), editorSchema);
        const attrs: Record<string, unknown>[] = [];
        root.descendants((n) => { if (n.type.name === 'image') attrs.push(n.attrs); });

        const [upload] = await getPendingImageUploads(imported.docId);
        expect(Array.from(upload.blobData)).toEqual([1, 2, 3]);
        expect(attrs).toEqual([expect.objectContaining({ alt: 'a', width: 320, align: 'right' })]);
        // The queue row stores the id as a uuid; the node keeps it as generated
        expect(String(attrs[0]['data-pending-id']).replace(/-/g, '')).toBe(upload.id.replace(/-/g, ''));
    });

    it('exports same-title notes in one folder under distinct names, each with its own image', async () => {
        const ID2 = '22222222-2222-2222-2222-222222222222';
        await saveDocumentUpdate(DOC_ID, noteBlob('file-a', 'jrnl_img0'));
        await saveDocumentUpdate(ID2, noteBlob('file-b', 'jrnl_img0'));
        await upsertSearchIndex({ docId: DOC_ID, title: 'Same', plainTextContent: 'bold', metadata: META() });
        await upsertSearchIndex({ docId: ID2, title: 'same', plainTextContent: 'bold', metadata: META() });
        mockGetPayloadBytes.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' });

        const { result, zip } = await exportedZip(fakeDotYouClient);

        expect(result.count).toBe(2);
        const mds = Object.keys(zip.files).filter((f) => f.endsWith('.md'));
        expect(mds).toHaveLength(2);
        const assets = Object.keys(zip.files).filter((f) => f.startsWith('assets/') && !f.endsWith('/'));
        expect(new Set(assets.map((a) => a.toLowerCase())).size).toBe(2);
        for (const md of mds) {
            const text = await zip.file(md)!.async('string');
            const link = /\(<?assets\/(.+?)>?\)\s*$/m.exec(text)![1];
            expect(zip.file(`assets/${link}`)).not.toBeNull();
            expect(link.startsWith(md.replace(/\.md$/, ''))).toBe(true);
        }

        const file = new File([await zip.generateAsync({ type: 'blob' })], 'export.zip');
        expect((await ImportService.importFiles([file])).imported).toBe(2);
        // Re-imported notes keep their front-matter titles, not the "(2)" file names
        const titles = (await getAllDocuments()).map((d) => d.title).sort();
        expect(titles).toEqual(['Same', 'Same', 'same', 'same']);
    });
});

describe('uniqueName', () => {
    it('suffixes repeated names and treats case-insensitive clashes as taken', () => {
        const taken = new Set<string>();
        expect(uniqueName(taken, 'Same')).toBe('Same');
        expect(uniqueName(taken, 'Same')).toBe('Same (2)');
        expect(uniqueName(taken, 'Same')).toBe('Same (3)');
        expect(uniqueName(taken, 'same')).toBe('same (4)');
        expect(uniqueName(taken, 'Same (2)')).toBe('Same (2) (2)');
        expect(uniqueName(taken, 'Untitled')).toBe('Untitled');
        expect(uniqueName(taken, 'Untitled')).toBe('Untitled (2)');
    });
});
