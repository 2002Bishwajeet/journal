// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import JSZip from 'jszip';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type { Node as PMNode } from '@tiptap/pm/model';
import { editorSchema } from '@/lib/agent/editEngine';

const { saveDocumentUpdate, savePendingImageUpload, upsertSyncRecord } = vi.hoisted(() => ({
    saveDocumentUpdate: vi.fn(),
    savePendingImageUpload: vi.fn(),
    upsertSyncRecord: vi.fn(),
}));
vi.mock('@/lib/db/queries', () => ({
    getAllFolders: vi.fn().mockResolvedValue([]),
    saveDocumentUpdate,
    savePendingImageUpload,
    upsertSyncRecord,
    upsertSearchIndex: vi.fn(),
    createFolder: vi.fn(),
}));
// happy-dom has no createImageBitmap; the ingest itself is covered in imageIngest.test.ts
const { prepareImageForUpload } = vi.hoisted(() => ({ prepareImageForUpload: vi.fn(async (file: File) => file) }));
vi.mock('@/lib/images/imageIngest', () => ({ prepareImageForUpload }));

import { ImportService, resolveImagePath } from '@/lib/importexport/ImportService';

describe('resolveImagePath', () => {
    it('resolves relative to the note, URL-decoded', () => {
        expect(resolveImagePath('Trips/note.md', 'assets/my%20cat.png')).toBe('Trips/assets/my cat.png');
        expect(resolveImagePath('Trips/note.md', './assets/x.png')).toBe('Trips/assets/x.png');
        expect(resolveImagePath('Trips/sub/note.md', '../img/x.png')).toBe('Trips/img/x.png');
        expect(resolveImagePath('note.md', '<assets/a b.png>')).toBe('assets/a b.png');
        expect(resolveImagePath('Trips/note.md', '/top.png')).toBe('top.png');
        expect(resolveImagePath('note.md', 'x.png?v=1#frag')).toBe('x.png');
    });

    it('leaves URLs alone', () => {
        expect(resolveImagePath('note.md', 'https://example.com/x.png')).toBeNull();
        expect(resolveImagePath('note.md', '//cdn.example.com/x.png')).toBeNull();
        expect(resolveImagePath('note.md', 'attachment://file/jrnl_img0')).toBeNull();
        expect(resolveImagePath('note.md', 'data:image/png;base64,AAAA')).toBeNull();
    });
});

describe('zip import with images', () => {
    it('queues zipped images as pending uploads of the note; missing ones become alt text', async () => {
        const zip = new JSZip();
        zip.file('Trips/note.md', [
            '# Trip',
            '',
            '![Cat](assets/my%20cat.png) and again ![Cat](assets/my cat.png)',
            '',
            '![Dog](assets/missing.png)',
            '',
            '![Remote](https://example.com/r.png)',
            '',
        ].join('\n'));
        zip.file('Trips/assets/my cat.png', new Uint8Array([1, 2, 3]));
        const file = new File([await zip.generateAsync({ type: 'blob' })], 'export.zip');

        const result = await ImportService.importFiles([file]);
        expect(result.imported).toBe(1);

        const docId = saveDocumentUpdate.mock.calls[0][0];
        // One queue row for the one image file, on the imported note
        expect(savePendingImageUpload).toHaveBeenCalledTimes(1);
        const upload = savePendingImageUpload.mock.calls[0][0];
        expect(upload).toMatchObject({ noteDocId: docId, contentType: 'image/png', status: 'pending', retryCount: 0 });
        expect(Array.from(upload.blobData)).toEqual([1, 2, 3]);
        expect(upsertSyncRecord).toHaveBeenCalledWith({ localId: docId, entityType: 'note', syncStatus: 'pending' });

        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, saveDocumentUpdate.mock.calls[0][1] as Uint8Array);
        const root = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment('prosemirror'), editorSchema);
        const images: PMNode[] = [];
        root.descendants((n) => { if (n.type.name === 'image') images.push(n); });

        const local = images.filter((n) => n.attrs['data-pending-id']);
        expect(local).toHaveLength(2);
        for (const img of local) {
            expect(img.attrs['data-pending-id']).toBe(upload.id);
            expect(img.attrs.src).toMatch(/^blob:/);
            expect(img.attrs.alt).toBe('Cat');
        }
        expect(images.map((n) => n.attrs.src)).toContain('https://example.com/r.png');
        expect(images).toHaveLength(3);
        expect(root.textContent).toContain('Dog');
        expect(root.textContent).not.toContain('missing.png');
    });
});
