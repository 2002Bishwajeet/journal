// @vitest-environment happy-dom
/**
 * The share page's scroll-spy (#643): at the bottom of the page a small change in the
 * content height (an image loading) must not flip the active heading back and forth (#1356).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useShareOutline } from '@/hooks/useShareOutline';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT = 800;
/** Each heading's top in the viewport, by id. */
const tops: Record<string, number> = {};
let scrollHeight = 3000;

function Article() {
    const ref = useRef<HTMLElement>(null);
    const { activeId } = useShareOutline(ref, 'content');
    return (
        <article ref={ref} data-active={activeId}>
            {['first', 'second', 'last'].map((id) => (
                <h2 key={id} id={id}>
                    {id}
                </h2>
            ))}
        </article>
    );
}

/** Scrolls to the bottom of a page `height` px tall, with each heading at its given top. */
async function layout(height: number, headingTops: Record<string, number>) {
    scrollHeight = height;
    Object.assign(tops, headingTops);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 2200 });
    await act(async () => window.dispatchEvent(new Event('scroll')));
}

let el: HTMLElement;
let root: Root;
const active = () => el.querySelector('article')?.dataset.active;

beforeEach(async () => {
    vi.stubGlobal(
        'IntersectionObserver',
        class {
            observe() {}
            disconnect() {}
        },
    );
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return { top: tops[this.id] ?? 0 } as DOMRect;
    });
    Object.assign(tops, { first: -1500, second: 50, last: 1200 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1000 });
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => root.render(createElement(Article)));
});

afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('useShareOutline scroll-spy', () => {
    it('makes a short last section active at the bottom of the page', async () => {
        expect(active()).toBe('second');
        // At the bottom the reading line is the viewport bottom: the last heading at 790 is read.
        await layout(3000, { first: -2000, second: -400, last: 790 });
        expect(active()).toBe('last');
    });

    it('keeps the last heading active while the content height wobbles at the bottom', async () => {
        await layout(3000, { first: -2000, second: -400, last: 790 });
        const seen: (string | undefined)[] = [];
        for (const height of [3012, 3000, 3012, 3000, 3012]) {
            // An image below the last heading loading and collapsing: the line moves, the heading doesn't.
            await layout(height, {});
            seen.push(active());
        }
        expect(seen).toEqual(['last', 'last', 'last', 'last', 'last']);
    });

    it('settles instead of ping-ponging when the height change crosses the last heading', async () => {
        // The last heading sits just below the line, then a shrink brings it above.
        await layout(3012, { first: -2000, second: -400, last: 795 });
        expect(active()).toBe('second');
        const seen: (string | undefined)[] = [];
        for (const height of [3000, 3012, 3000, 3012]) {
            await layout(height, {});
            seen.push(active());
        }
        expect(seen).toEqual(['last', 'last', 'last', 'last']);
    });

    it('goes back to the previous heading once the reader scrolls well above the current one', async () => {
        await layout(3000, { first: -2000, second: -400, last: 790 });
        Object.defineProperty(window, 'scrollY', { configurable: true, value: 1000 });
        Object.assign(tops, { first: -800, second: 50, last: 1990 });
        await act(async () => window.dispatchEvent(new Event('scroll')));
        expect(active()).toBe('second');
    });
});
