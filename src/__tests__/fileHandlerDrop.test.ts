// @vitest-environment happy-dom
/**
 * #180: dropped images landed at the cursor, not where they were dropped.
 * handleDrop now reads the drop coordinates via view.posAtCoords and inserts
 * there instead of at the current selection.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { FileHandler } from '@/components/editor/plugins/FileHandler';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// Same rationale as fileHandlerInsert.test.ts: happy-dom can't decode a real
// image, so pass the file through unchanged and test FileHandler's own logic.
vi.mock('@/lib/images/imageIngest', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/images/imageIngest')>();
    return { ...actual, prepareImageForUpload: vi.fn(async (file: File) => file) };
});

const onImageDrop = vi.fn(async () => { });

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
        content: '<p>Hello</p>',
    });
}

function imageNodes(e: Editor): { pos: number; src: unknown }[] {
    const out: { pos: number; src: unknown }[] = [];
    e.state.doc.descendants((n, pos) => {
        if (n.type.name === 'image') out.push({ pos, src: n.attrs.src });
    });
    return out;
}

const file = (name: string, type = 'image/png') => new File([new Uint8Array(10)], name, { type });

function drop(e: Editor, files: File[], pos: number) {
    vi.spyOn(e.view, 'posAtCoords').mockReturnValue({ pos, inside: -1 });
    const event = new Event('drop') as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    const handled = e.view.someProp('handleDrop', (f) => f(e.view, event, e.state.doc.slice(0, 0), false));
    expect(handled).toBe(true);
}

describe('FileHandler drop position (#180)', () => {
    let e: Editor;
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(URL, 'createObjectURL').mockImplementation((f) => `blob:${(f as File).name}`);
        e = mkEditor();
    });
    afterEach(() => e.destroy());

    it('inserts a dropped image at the drop position, not the selection', async () => {
        e.commands.setTextSelection(6); // cursor at the end of "Hello", away from the drop point
        drop(e, [file('a.png')], 3);

        await vi.waitFor(() => expect(imageNodes(e)).toHaveLength(1));
        expect(imageNodes(e)[0].pos).toBe(3);
    });

    it('puts several dropped files in one gallery, in order, at the drop position (#601)', async () => {
        drop(e, [file('a.png'), file('b.png'), file('c.png')], 3);

        await vi.waitFor(() => expect(imageNodes(e)).toHaveLength(3));
        expect(imageNodes(e).map(n => n.src)).toEqual(['blob:a.png', 'blob:b.png', 'blob:c.png']);
        // "He" | gallery | "llo"
        expect(e.state.doc.content.content.map((n) => n.type.name)).toEqual(['paragraph', 'gallery', 'paragraph']);
        expect(e.state.doc.child(1).childCount).toBe(3);
    });

    it('puts several pasted files in one gallery (#601)', async () => {
        const files = [file('a.png'), file('b.png')];
        const event = new Event('paste') as ClipboardEvent;
        Object.defineProperty(event, 'clipboardData', {
            value: { items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })) },
        });
        e.view.someProp('handlePaste', (f) => f(e.view, event, e.state.doc.slice(0, 0)));

        await vi.waitFor(() => expect(imageNodes(e)).toHaveLength(2));
        let galleries = 0;
        e.state.doc.descendants((n) => { if (n.type.name === 'gallery') galleries++; });
        expect(galleries).toBe(1);
    });
});
