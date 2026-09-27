// @vitest-environment happy-dom
/**
 * #182: any uploaded or plain image can be opened full-size in a lightbox via
 * the Expand button or a double-click, and closed with Esc.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NodeViewProps } from '@tiptap/react';

vi.mock('@/components/OdinImage/OdinImage', () => ({ OdinImage: () => null }));
vi.mock('@/hooks/usePendingImage', () => ({ usePendingImage: () => ({ url: 'blob:restored', state: 'uploading' as const }) }));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ sync: async () => {} }) }));
vi.mock('@/lib/db', () => ({ retryPendingImageUploadNow: async () => {}, deletePendingImageUpload: async () => {} }));

import { ImageNodeView } from '@/components/editor/nodes/ImageNode';

const SRC = 'https://example.com/kite.png';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ImageNodeView — click-to-zoom lightbox (plain image)', () => {
    let root: Root;
    let el: HTMLDivElement;

    afterEach(async () => {
        await act(async () => root.unmount());
        el.remove();
    });

    async function renderPlain() {
        el = document.createElement('div');
        document.body.appendChild(el);
        root = createRoot(el);
        const props = {
            node: { attrs: { src: SRC, alt: 'A red kite', width: null, align: null } },
            updateAttributes: () => {},
            selected: false,
        } as unknown as NodeViewProps;
        await act(async () => { root.render(h(ImageNodeView, props)); });
    }

    it('opens a dialog with the same src when "View full size" is clicked', async () => {
        await renderPlain();
        const expandButton = el.querySelector('button[aria-label="View full size"]') as HTMLButtonElement;
        expect(expandButton).not.toBeNull();

        await act(async () => { expandButton.click(); });

        const dialogImg = document.body.querySelector('[role="dialog"] img');
        expect(dialogImg?.getAttribute('src')).toBe(SRC);
    });

    it('opens on a double-click of the image', async () => {
        await renderPlain();
        const img = el.querySelector('img.max-w-full, img.w-full') as HTMLImageElement;

        await act(async () => {
            img.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        });

        expect(document.body.querySelector('[role="dialog"] img')?.getAttribute('src')).toBe(SRC);
    });

    it('closes on Escape', async () => {
        await renderPlain();
        const expandButton = el.querySelector('button[aria-label="View full size"]') as HTMLButtonElement;
        await act(async () => { expandButton.click(); });
        expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });

        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });
});

// A pending node's own src is a blob: URL that's already dead by the time it
// could be clicked (it dies with the tab), so it must not offer to zoom.
describe('ImageNodeView — click-to-zoom lightbox (pending upload)', () => {
    let root: Root;
    let el: HTMLDivElement;

    afterEach(async () => {
        await act(async () => root.unmount());
        el.remove();
    });

    it('offers no "View full size" control while the upload is still pending', async () => {
        el = document.createElement('div');
        document.body.appendChild(el);
        root = createRoot(el);
        const props = {
            node: { attrs: { src: 'blob:dead-after-reload', 'data-pending-id': 'pending-1', alt: null, width: null, align: null } },
            updateAttributes: () => {},
            deleteNode: () => {},
            selected: false,
        } as unknown as NodeViewProps;

        await act(async () => { root.render(h(ImageNodeView, props)); });

        expect(el.querySelector('button[aria-label="View full size"]')).toBeNull();
    });
});
