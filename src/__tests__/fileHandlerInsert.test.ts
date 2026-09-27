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

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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
                allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
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

        await vi.waitFor(() => expect(onImageDrop).toHaveBeenCalledTimes(1));
        const [img] = images(e);
        expect(img.src).toBe('blob:test');
        expect(img['data-pending-id']).toBeTruthy();
        expect(onImageDrop).toHaveBeenCalledWith(png, img['data-pending-id']);
    });

    it('rejects a file over the size cap', async () => {
        e.commands.insertImageFiles([file('image/png', 6 * 1024 * 1024)]);

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('File too large. Maximum size is 5MB'));
        expect(images(e)).toEqual([]);
        expect(onImageDrop).not.toHaveBeenCalled();
    });

    it('rejects an unsupported type', async () => {
        e.commands.insertImageFiles([file('image/heic')]);

        await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Unsupported file type: image/heic'));
        expect(images(e)).toEqual([]);
        expect(onImageDrop).not.toHaveBeenCalled();
    });
});
