// @vitest-environment happy-dom
/**
 * #1387: OdinImage holds the box it is given from the first paint and keeps it, and with an
 * embedded tiny thumbnail (which loads at once) it still fetches the bytes only once in view.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createElement as h, forwardRef, useEffect, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const m = vi.hoisted(() => ({ inView: null as (() => void) | null, picked: [] as unknown[], thumbLoad: null as ((e: unknown) => void) | null }));

vi.mock('@/hooks/useIntersection', () => ({
    useIntersection: (_ref: unknown, callback: () => void) => {
        m.inView = callback;
    },
}));
vi.mock('@/hooks/useOnlineContext', () => ({ useOnlineContext: () => ({ isOnline: true }) }));
// The embedded thumbnail loads at once: report it loaded as soon as it mounts
vi.mock('@/components/OdinImage/OdinPreviewImage', () => ({
    OdinPreviewImage: forwardRef<HTMLImageElement, { onLoad: (size: undefined, tiny: undefined) => void }>(function Preview({ onLoad }, ref) {
        useEffect(() => onLoad(undefined, undefined), [onLoad]);
        return h('img', { ref, 'data-testid': 'tiny' });
    }),
}));
vi.mock('@/components/OdinImage/OdinThumbnailImage', () => ({
    OdinThumbnailImage: ({ loadSize, onLoad }: { loadSize: { pixelWidth: number }; onLoad: (e: unknown) => void }) => {
        m.thumbLoad = onLoad;
        return h('span', { 'data-testid': 'thumb', 'data-width': loadSize.pixelWidth });
    },
}));
vi.mock('@/components/OdinImage/OdinPayloadImage', () => ({
    OdinPayloadImage: () => h('span', { 'data-testid': 'payload' }),
}));
vi.mock('@/components/OdinImage/pickLoadSize', () => ({
    pickLoadSize: (input: unknown) => {
        m.picked.push(input);
        return { pixelWidth: 640, pixelHeight: 360 };
    },
}));

import { OdinImage } from '@/components/OdinImage/OdinImage';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const base = { dotYouClient: {} as never, targetDrive: { alias: 'a', type: 't' }, fileId: 'f', fileKey: 'k' };
const tiny = { contentType: 'image/jpeg' as const, content: 'AAAA', pixelWidth: 20, pixelHeight: 11 };
const sizes = [{ pixelWidth: 320, pixelHeight: 180 }, { pixelWidth: 640, pixelHeight: 360 }];

describe('OdinImage reserving its box', () => {
    let root: Root;
    let el: HTMLDivElement;
    afterEach(async () => {
        m.inView = null;
        m.picked = [];
        m.thumbLoad = null;
        await act(async () => root.unmount());
    });

    async function render(props: Record<string, unknown>) {
        el = document.createElement('div');
        document.body.appendChild(el);
        root = createRoot(el);
        await act(async () => { root.render(h(OdinImage, { ...base, ...props } as never)); });
        return el.firstElementChild as HTMLElement;
    }

    it('holds the given size from the first render, not the tiny thumbnail\'s', async () => {
        const box = await render({ initialSize: { pixelWidth: 1600, pixelHeight: 900 }, previewThumbnail: tiny, thumbSizes: sizes });
        expect(box.style.aspectRatio).toBe('1600 / 900');
        expect(box.style.maxWidth).toBe('1600px');
        expect(box.getAttribute('data-natural-size')).toBe('1600x900');
    });

    it('fetches no bytes until in view, though the embedded thumbnail has loaded', async () => {
        await render({ initialSize: { pixelWidth: 1600, pixelHeight: 900 }, previewThumbnail: tiny, thumbSizes: sizes });
        expect(el.querySelector('[data-testid="tiny"]')).not.toBeNull();
        expect(el.querySelector('[data-testid="thumb"]')).toBeNull();
        expect(el.querySelector('[data-testid="payload"]')).toBeNull();

        await act(async () => m.inView?.());
        expect(el.querySelector('[data-testid="thumb"]')?.getAttribute('data-width')).toBe('640');
    });

    it('picks the thumbnail from the sizes the header listed, with none fetched', async () => {
        await render({ initialSize: { pixelWidth: 1600, pixelHeight: 900 }, previewThumbnail: tiny, thumbSizes: sizes });
        await act(async () => m.inView?.());
        expect(m.picked[0]).toMatchObject({ sizes });
    });

    it('loads the full image for a payload with no thumbnails (an svg or gif)', async () => {
        await render({ initialSize: { pixelWidth: 100, pixelHeight: 100 }, previewThumbnail: tiny, thumbSizes: [] });
        await act(async () => m.inView?.());
        expect(el.querySelector('[data-testid="payload"]')).not.toBeNull();
        expect(m.picked).toHaveLength(0);
    });

    it('reads the loaded size when the image loads, as React clears currentTarget after the handler', async () => {
        const box = await render({ previewThumbnail: tiny, thumbSizes: sizes });
        await act(async () => m.inView?.());
        // Two loads in one batch: the second's state update is run during render, not in the handler
        await act(async () => {
            for (const [w, h] of [[320, 180], [640, 360]]) {
                const event = { currentTarget: { naturalWidth: w, naturalHeight: h } as unknown };
                m.thumbLoad!(event);
                event.currentTarget = null;
            }
        });
        expect(box.getAttribute('data-natural-size')).toBe('640x360');
    });
});
