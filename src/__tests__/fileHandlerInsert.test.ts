// @vitest-environment happy-dom
/**
 * #90: the toolbar "Add Image" button used to read the file as a data: URL and
 * setImage it — no size/type validation, no upload, base64 bytes in the Yjs doc.
 * It now goes through the same path as drop/paste via `insertImageFiles`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { toast } from 'sonner';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { FileHandler } from '@/components/editor/plugins/FileHandler';
import { prepareImageForUpload, UnsupportedImageError } from '@/lib/images/imageIngest';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// #176's prepareImageForUpload decodes via createImageBitmap, which happy-dom
// doesn't implement for File sources. These tests are about FileHandler's own
// orchestration (queueing order, size/type checks), so pass the file through
// unchanged — imageIngest.test.ts covers the processing itself.
vi.mock('@/lib/images/imageIngest', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/images/imageIngest')>();
    return { ...actual, prepareImageForUpload: vi.fn(async (file: File) => file) };
});

const onImageDrop = vi.fn(async () => {});

function mkEditor() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return new Editor({
        element: el,
        extensions: [
            ...createBaseExtensions(),
            FileHandler.configure({
                maxSizeMB: 5,
                allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif'],
                onImageDrop,
            }),
        ],
        content: '<p></p>',
    });
}

function images(e: Editor): Record<string, unknown>[] {
    const out: Record<string, unknown>[] = [];
    e.state.doc.descendants((n) => {
        if (n.type.name === 'image') out.push(n.attrs);
    });
    return out;
}

const file = (type: string, size = 10) => new File([new Uint8Array(size)], 'x', { type });

describe('FileHandler insertImageFiles command (toolbar insert)', () => {
    let e: Editor;
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
        e = mkEditor();
    });
    afterEach(() => {
        expect(e.getHTML()).not.toContain('src="data:');
        e.destroy();
    });

    it('inserts a pending blob image and queues it for upload', async () => {
        const png = file('image/png');
        e.commands.insertImageFiles([png]);

        await vi.waitFor(() => expect(images(e)).toHaveLength(1));
        const [img] = images(e);
        expect(img.src).toBe('blob:test');
        expect(img['data-pending-id']).toBeTruthy();
        expect(onImageDrop).toHaveBeenCalledWith(png, img['data-pending-id']);
        // #177: the node shows its own upload state; no success toast
        await Promise.resolve();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it('queues before inserting, so the node never exists without its row', async () => {
        onImageDrop.mockImplementationOnce(async () => { expect(images(e)).toEqual([]); });
        e.commands.insertImageFiles([file('image/png')]);

        await vi.waitFor(() => expect(images(e)).toHaveLength(1));
    });

    it('inserts nothing when queueing fails', async () => {
        onImageDrop.mockRejectedValueOnce(new Error('db'));
        e.commands.insertImageFiles([file('image/png')]);

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to queue image for upload'));
        expect(images(e)).toEqual([]);
    });

    it('rejects a file over the size cap', async () => {
        e.commands.insertImageFiles([file('image/png', 6 * 1024 * 1024)]);

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('File too large. Maximum size is 5MB'));
        expect(images(e)).toEqual([]);
        expect(onImageDrop).not.toHaveBeenCalled();
    });

    it('rejects an unsupported type', async () => {
        e.commands.insertImageFiles([file('image/svg+xml')]);

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Unsupported file type: image/svg+xml'));
        expect(images(e)).toEqual([]);
        expect(onImageDrop).not.toHaveBeenCalled();
    });

    it('reports HEIC decode failures with a friendly toast (#176)', async () => {
        vi.mocked(prepareImageForUpload).mockRejectedValueOnce(new UnsupportedImageError());
        e.commands.insertImageFiles([file('image/heic')]);

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith(
            "This browser can't read HEIC images — export the photo as JPEG",
        ));
        expect(images(e)).toEqual([]);
        expect(onImageDrop).not.toHaveBeenCalled();
    });
});

describe('FileHandler drop/paste of an unsupported type (#176)', () => {
    let e: Editor;
    beforeEach(() => {
        vi.clearAllMocks();
        e = mkEditor();
    });
    afterEach(() => e.destroy());

    it('shows a toast and swallows the drop when no dropped file is allowed', () => {
        const svg = file('image/svg+xml');
        const event = new Event('drop') as DragEvent;
        Object.defineProperty(event, 'dataTransfer', { value: { files: [svg] } });

        const handled = e.view.someProp('handleDrop', (f) => f(e.view, event, e.state.doc.slice(0, 0), false));

        expect(handled).toBe(true);
        expect(toast.error).toHaveBeenCalledWith('Unsupported image type');
        expect(images(e)).toEqual([]);
    });

    it('shows a toast and swallows the paste when no pasted file is allowed', () => {
        const svg = file('image/svg+xml');
        const event = new Event('paste') as ClipboardEvent;
        Object.defineProperty(event, 'clipboardData', {
            value: { items: [{ kind: 'file', type: 'image/svg+xml', getAsFile: () => svg }] },
        });

        const handled = e.view.someProp('handlePaste', (f) => f(e.view, event, e.state.doc.slice(0, 0)));

        expect(handled).toBe(true);
        expect(toast.error).toHaveBeenCalledWith('Unsupported image type');
        expect(images(e)).toEqual([]);
    });
});
