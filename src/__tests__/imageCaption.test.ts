// @vitest-environment happy-dom
/**
 * #583: an image's alt text shows as a caption under it in the editor; no alt, no caption.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NodeViewProps } from '@tiptap/react';

vi.mock('@/components/OdinImage/OdinImage', () => ({ OdinImage: () => null }));
vi.mock('@/hooks/usePendingImage', () => ({ usePendingImage: () => ({ url: undefined, state: 'remote' as const }) }));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ sync: async () => {} }) }));
vi.mock('@/lib/db', () => ({ retryPendingImageUploadNow: async () => {}, deletePendingImageUpload: async () => {} }));

import { ImageNodeView } from '@/components/editor/nodes/ImageNode';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ImageNodeView caption', () => {
    let root: Root;
    let el: HTMLDivElement;

    afterEach(async () => {
        await act(async () => root.unmount());
        el.remove();
    });

    async function render(alt: string | null) {
        el = document.createElement('div');
        document.body.appendChild(el);
        root = createRoot(el);
        const props = {
            node: { attrs: { src: 'https://example.com/kite.png', alt, width: null, align: null } },
            updateAttributes: () => {},
            selected: false,
        } as unknown as NodeViewProps;
        await act(async () => { root.render(h(ImageNodeView, props)); });
    }

    it('shows the alt text under the image', async () => {
        await render('A red kite over the hills');
        const caption = el.querySelector('[data-testid="image-caption"]');
        expect(caption?.textContent).toBe('A red kite over the hills');
        // After the image in document order, not above it
        const img = el.querySelector('img')!;
        expect(img.compareDocumentPosition(caption!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // Screen readers already get it from alt
        expect(caption?.getAttribute('aria-hidden')).toBe('true');
    });

    it('shows no caption without alt text', async () => {
        await render(null);
        expect(el.querySelector('[data-testid="image-caption"]')).toBeNull();
    });
});
