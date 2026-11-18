// @vitest-environment happy-dom
/** #1387: a node with no stored size gets one in a single write: the header's, else the first image that loads. */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createElement as h, useRef, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useBackfillImageSize } from '@/hooks/image/useBackfillImageSize';
import type { Size } from '@/lib/images/imageEdits';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

interface Props {
    enabled?: boolean;
    stored?: Size;
    fromHeader?: Size;
    write: (size: Size) => void;
}

function Box({ enabled = true, stored, fromHeader, write }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    useBackfillImageSize(ref, { enabled, stored, fromHeader, write });
    return (
        <div ref={ref}>
            <img data-testid="tiny" aria-hidden="true" alt="" />
            <img data-testid="full" alt="x" />
        </div>
    );
}

/** Makes the img look decoded at `width` x `height`, then fires its load event. */
function load(img: Element, width: number, height: number) {
    Object.defineProperty(img, 'naturalWidth', { value: width, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: height, configurable: true });
    img.dispatchEvent(new Event('load'));
}

describe('useBackfillImageSize', () => {
    let root: Root;
    let el: HTMLDivElement;
    afterEach(async () => {
        await act(async () => root.unmount());
    });

    async function render(props: Props) {
        el = document.createElement('div');
        root = createRoot(el);
        await act(async () => { root.render(h(Box, props)); });
    }

    it('writes the size the header lists, once, without waiting for a load', async () => {
        const write = vi.fn();
        await render({ fromHeader: { width: 1600, height: 900 }, write });
        expect(write).toHaveBeenCalledTimes(1);
        expect(write).toHaveBeenCalledWith({ width: 1600, height: 900 });
        // A new object with the same numbers (a refetch) is not a new write
        await act(async () => { root.render(h(Box, { fromHeader: { width: 1600, height: 900 }, write })); });
        expect(write).toHaveBeenCalledTimes(1);
    });

    it('writes the first loaded image\'s size, ignoring the aria-hidden tiny thumbnail', async () => {
        const write = vi.fn();
        await render({ write });
        await act(async () => load(el.querySelector('[data-testid="tiny"]')!, 20, 11));
        expect(write).not.toHaveBeenCalled();
        await act(async () => load(el.querySelector('[data-testid="full"]')!, 1280, 720));
        expect(write).toHaveBeenCalledWith({ width: 1280, height: 720 });
    });

    it('writes nothing when the node has a size, or the editor is view-only', async () => {
        const stored = vi.fn();
        await render({ stored: { width: 800, height: 400 }, fromHeader: { width: 1600, height: 900 }, write: stored });
        await act(async () => load(el.querySelector('[data-testid="full"]')!, 1280, 720));
        expect(stored).not.toHaveBeenCalled();
        await act(async () => root.unmount());

        const viewOnly = vi.fn();
        await render({ enabled: false, fromHeader: { width: 1600, height: 900 }, write: viewOnly });
        await act(async () => load(el.querySelector('[data-testid="full"]')!, 1280, 720));
        expect(viewOnly).not.toHaveBeenCalled();
    });

    it('stops listening once the node has its size', async () => {
        const write = vi.fn();
        await render({ write });
        await act(async () => { root.render(h(Box, { stored: { width: 1280, height: 720 }, write })); });
        await act(async () => load(el.querySelector('[data-testid="full"]')!, 640, 360));
        expect(write).not.toHaveBeenCalled();
    });
});
