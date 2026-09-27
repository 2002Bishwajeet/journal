// @vitest-environment happy-dom
/**
 * #177: the pending node renders from the locally queued bytes (never its dead
 * blob: src), says what state the upload is in, and offers Retry/Remove on failure.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NodeViewProps } from '@tiptap/react';
import type { PendingImageState } from '@/hooks/usePendingImage';

const m = vi.hoisted(() => ({
    pending: { url: 'blob:restored' as string | undefined, state: 'failed' as PendingImageState },
    sync: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
}));
vi.mock('@/hooks/usePendingImage', () => ({ usePendingImage: () => m.pending }));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ sync: m.sync }) }));
vi.mock('@/lib/db', () => ({ retryPendingImageUploadNow: m.retry, deletePendingImageUpload: m.remove }));
vi.mock('@/components/OdinImage/OdinImage', () => ({ OdinImage: () => null }));

import { ImageNodeView } from '@/components/editor/nodes/ImageNode';

const ID = 'pending-1';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ImageNodeView pending image', () => {
    let root: Root;
    let el: HTMLDivElement;
    const deleteNode = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        el = document.createElement('div');
        root = createRoot(el);
    });
    afterEach(async () => { await act(async () => root.unmount()); });

    async function render(url: string | undefined, state: PendingImageState) {
        m.pending = { url, state };
        const props = {
            node: { attrs: { src: 'blob:dead-after-reload', 'data-pending-id': ID, width: null, align: null } },
            updateAttributes: () => {},
            deleteNode,
            selected: false,
        } as unknown as NodeViewProps;
        await act(async () => { root.render(h(ImageNodeView, props)); });
    }
    const button = (name: string) =>
        Array.from(el.querySelectorAll('button')).find(b => b.textContent === name);

    it('shows the locally queued bytes, not the node src', async () => {
        await render('blob:restored', 'uploading');
        expect(el.querySelector('img')?.getAttribute('src')).toBe('blob:restored');
        expect(el.textContent).toContain('Uploading');
    });

    it('says it is waiting for a connection when offline', async () => {
        await render('blob:restored', 'offline');
        expect(el.textContent).toContain('Waiting for connection');
    });

    it('offers Retry on failure: requeues now and syncs', async () => {
        await render('blob:restored', 'failed');
        expect(el.textContent).toContain('Upload failed');

        await act(async () => { button('Retry')?.click(); });

        expect(m.retry).toHaveBeenCalledWith(ID);
        expect(m.sync).toHaveBeenCalled();
    });

    it('offers Remove on failure: drops the node and the queued bytes', async () => {
        await render('blob:restored', 'failed');

        await act(async () => { button('Remove')?.click(); });

        expect(deleteNode).toHaveBeenCalled();
        expect(m.remove).toHaveBeenCalledWith(ID);
    });

    it('shows a neutral box, not a broken image, for another device\'s upload', async () => {
        await render(undefined, 'remote');
        expect(el.querySelector('img')).toBeNull();
        expect(el.textContent).toContain('Uploading from another device');
    });
});
