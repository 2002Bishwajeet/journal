// @vitest-environment happy-dom
/**
 * #178: images in a note shared with you are payloads on the AUTHOR's drive, so
 * OdinImage must fetch them over peer from the author, not from the viewer's own
 * identity. And images can't be added to such a note (no peer upload yet).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NodeViewProps } from '@tiptap/react';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { Editor } from '@tiptap/core';
import { toast } from 'sonner';

const { odinImageProps } = vi.hoisted(() => ({ odinImageProps: [] as Record<string, unknown>[] }));
vi.mock('@/components/OdinImage/OdinImage', () => ({
    OdinImage: (props: Record<string, unknown>) => { odinImageProps.push(props); return null; },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { DotYouClientContext } from '@/components/auth/DotYouClientContext';
import { ImageNodeView } from '@/components/editor/nodes/ImageNode';
import { ImageOwnerContext } from '@/components/editor/nodes/imageOwnerContext';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { FileHandler } from '@/components/editor/plugins/FileHandler';

const HOST = 'bob.dotyou.cloud';
const AUTHOR = 'alice.dotyou.cloud';
const client = { getHostIdentity: () => HOST } as unknown as DotYouClient;

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ImageNodeView in a peer note', () => {
    let root: Root;
    beforeEach(() => { odinImageProps.length = 0; root = createRoot(document.createElement('div')); });
    afterEach(async () => { await act(async () => root.unmount()); });

    async function renderWithOwner(owner: string | undefined) {
        const props = {
            node: { attrs: { src: 'attachment://file-1/jrnl_img0', width: null, align: null } },
            updateAttributes: () => {},
            selected: false,
        } as unknown as NodeViewProps;
        await act(async () => {
            root.render(h(DotYouClientContext.Provider, { value: client },
                h(ImageOwnerContext.Provider, { value: owner }, h(ImageNodeView, props))));
        });
        return odinImageProps.at(-1);
    }

    it('fetches the image from the note author over peer', async () => {
        expect((await renderWithOwner(AUTHOR))?.odinId).toBe(AUTHOR);
    });

    it('fetches from the own identity for an own note', async () => {
        expect((await renderWithOwner(undefined))?.odinId).toBeUndefined();
    });
});

describe('FileHandler in a peer note', () => {
    it('does not insert an image on paste and says why', () => {
        const onImageDrop = vi.fn(async () => {});
        const el = document.createElement('div');
        document.body.appendChild(el);
        const editor = new Editor({
            element: el,
            content: '<p></p>',
            extensions: [
                ...createBaseExtensions(),
                FileHandler.configure({ maxSizeMB: 5, onImageDrop, imagesReadOnly: true }),
            ],
        });
        const file = new File([new Uint8Array(10)], 'x.png', { type: 'image/png' });
        const event = new Event('paste') as ClipboardEvent;
        Object.defineProperty(event, 'clipboardData', {
            value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] },
        });

        const handled = editor.view.someProp('handlePaste', (f) => f(editor.view, event, editor.state.doc.slice(0, 0)));

        expect(handled).toBe(true);
        expect(editor.getHTML()).not.toContain('<img');
        expect(onImageDrop).not.toHaveBeenCalled();
        expect(toast.error).toHaveBeenCalledWith("Images can't be added to notes shared with you yet");
        editor.destroy();
    });
});
