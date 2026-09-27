// @vitest-environment happy-dom
/**
 * #179: an uploaded image renders from its locally kept bytes when this device
 * has them (works offline); otherwise from the server via OdinImage. A server
 * image that fails while offline says so instead of "Something went wrong".
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NodeViewProps } from '@tiptap/react';

const m = vi.hoisted(() => ({ local: null as string | null | undefined }));
vi.mock('@/hooks/image/useLocalImage', () => ({ useLocalImage: () => m.local }));
vi.mock('@/hooks/usePendingImage', () => ({ usePendingImage: () => ({ url: undefined, state: 'remote' as const }) }));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ sync: async () => {} }) }));
vi.mock('@/lib/db', () => ({ retryPendingImageUploadNow: async () => {}, deletePendingImageUpload: async () => {} }));
vi.mock('@/components/OdinImage/OdinImage', () => ({
    OdinImage: ({ fileId, fileKey }: { fileId: string; fileKey: string }) =>
        h('span', { 'data-testid': 'odin', 'data-file': `${fileId}/${fileKey}` }),
}));

import { ImageNodeView } from '@/components/editor/nodes/ImageNode';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ImageNodeView attachment image', () => {
    let root: Root;
    let el: HTMLDivElement;

    beforeEach(() => {
        el = document.createElement('div');
        root = createRoot(el);
    });
    afterEach(async () => { await act(async () => root.unmount()); });

    async function render() {
        const props = {
            node: { attrs: { src: 'attachment://file-1/jrnl_img0', alt: 'kite', width: null, align: null } },
            updateAttributes: () => {},
            selected: false,
        } as unknown as NodeViewProps;
        await act(async () => { root.render(h(ImageNodeView, props)); });
    }

    it('renders the locally kept bytes when this device has them', async () => {
        m.local = 'blob:local';
        await render();
        const img = el.querySelector('img');
        expect(img?.getAttribute('src')).toBe('blob:local');
        expect(img?.getAttribute('alt')).toBe('kite');
        expect(el.querySelector('[data-testid="odin"]')).toBeNull();
    });

    it('fetches nothing from the server while the local lookup is pending', async () => {
        m.local = undefined;
        await render();
        expect(el.querySelector('[data-testid="odin"]')).toBeNull();
        expect(el.querySelector('img')).toBeNull();
    });

    it('falls back to the server image otherwise', async () => {
        m.local = null;
        await render();
        expect(el.querySelector('[data-testid="odin"]')?.getAttribute('data-file')).toBe('file-1/jrnl_img0');
    });
});
