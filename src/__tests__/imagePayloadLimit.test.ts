// @vitest-environment happy-dom
/**
 * #876: Homebase allows 25 payloads per file. The note's text takes one, each image
 * and each link preview another, so FileHandler stops at the limit.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { toast } from 'sonner';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { FileHandler } from '@/components/editor/plugins/FileHandler';
import { countNotePayloads, imageRoom, MAX_NOTE_PAYLOADS } from '@/lib/images/payloadLimit';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/images/imageIngest', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/images/imageIngest')>();
    return { ...actual, prepareImageForUpload: vi.fn(async (file: File) => file) };
});

const onImageDrop = vi.fn(async () => {});
const png = () => new File([new Uint8Array(10)], 'x', { type: 'image/png' });
const img = { type: 'image', attrs: { src: 'blob:x' } };
const preview = { type: 'linkPreview', attrs: { url: 'https://example.com' } };

function mkEditor(content: { type: string }[]) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return new Editor({
        element: el,
        extensions: [
            ...createBaseExtensions(),
            FileHandler.configure({ maxSizeMB: 5, allowedTypes: ['image/png'], onImageDrop }),
        ],
        content: { type: 'doc', content: [{ type: 'paragraph', content: content.filter((n) => n.type === 'image') }, ...content.filter((n) => n.type !== 'image')] },
    });
}

const imageCount = (e: Editor) => {
    let n = 0;
    e.state.doc.descendants((node) => { if (node.type.name === 'image') n++; });
    return n;
};

describe('payload count', () => {
    let e: Editor;
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    });
    afterEach(() => e.destroy());

    it('counts the text, every image and every link preview', () => {
        e = mkEditor([img, img, preview]);
        expect(countNotePayloads(e.state.doc)).toBe(4);
        expect(imageRoom(e.state.doc)).toBe(MAX_NOTE_PAYLOADS - 4);
    });

    it('an empty note holds 24 images', () => {
        e = mkEditor([]);
        expect(imageRoom(e.state.doc)).toBe(24);
    });

    it('link previews take room from images', () => {
        e = mkEditor([preview, preview]);
        expect(imageRoom(e.state.doc)).toBe(22);
    });

    it('adds nothing and says why when the note is full', async () => {
        e = mkEditor(Array.from({ length: 24 }, () => img));
        e.commands.insertImageFiles([png()]);
        await new Promise((r) => setTimeout(r, 20));
        expect(imageCount(e)).toBe(24);
        expect(onImageDrop).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('at most 24 images'));
    });

    it('takes only the files that fit', async () => {
        e = mkEditor([...Array.from({ length: 21 }, () => img), preview]);
        e.commands.insertImageGallery([png(), png(), png()]);
        await vi.waitFor(() => expect(imageCount(e)).toBe(23));
        expect(onImageDrop).toHaveBeenCalledTimes(2);
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('room for 2 more images'));
    });
});
