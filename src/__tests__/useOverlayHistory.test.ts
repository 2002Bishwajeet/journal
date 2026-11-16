// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { useOverlayHistory, overlayEntryOpen } from '@/hooks/useOverlayHistory';

// When set, the hook's navigate only writes the browser entry, as BrowserRouter does
// before the location renders in its transition.
const pendingPush = vi.hoisted(() => ({ on: false }));
// When set, Back (navigate(-1)) lands later, as a browser's history.back() does: queued
// until the test runs it.
const laterBack = vi.hoisted(() => ({ on: false, queue: [] as (() => void)[] }));
vi.mock('react-router-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        useNavigate: () => {
            const navigate = actual.useNavigate();
            return ((to: unknown, options?: { state?: unknown }) =>
                pendingPush.on && typeof to === 'object'
                    ? window.history.pushState({ usr: options?.state, key: 'sheet', idx: 2 }, '')
                    : laterBack.on && typeof to === 'number'
                      ? void laterBack.queue.push(() => navigate(to))
                      : navigate(to as never, options)) as typeof navigate;
        },
    };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Spec = { open: boolean; close: () => void };
type Probe = { navigate: ReturnType<typeof useNavigate>; path: () => string; stack: () => string[] };

function mount(initial: Spec[]) {
    const probe = {} as Probe;
    function Overlay({ o }: { o: Spec }) {
        useOverlayHistory(o.open, o.close);
        return null;
    }
    function Harness({ list }: { list: Spec[] }) {
        const loc = useLocation();
        probe.navigate = useNavigate();
        probe.path = () => loc.pathname;
        probe.stack = () => (loc.state as { overlays?: string[] } | null)?.overlays ?? [];
        return h('div', null, ...list.map((o, i) => h(Overlay, { key: i, o })));
    }
    const root = createRoot(document.createElement('div'));
    const render = (list: Spec[]) =>
        act(() => root.render(h(MemoryRouter, { initialEntries: ['/', '/folder'], initialIndex: 1 }, h(Harness, { list }))));
    render(initial);
    return { probe, render };
}

beforeEach(() => {
    window.innerWidth = 393;
    pendingPush.on = false;
    laterBack.on = false;
    laterBack.queue = [];
});

describe('useOverlayHistory', () => {
    it('pushes one entry when opened and calls close on Back', () => {
        const close = vi.fn();
        const { probe, render } = mount([{ open: false, close }]);
        render([{ open: true, close }]);
        expect(probe.stack()).toHaveLength(1);
        expect(probe.path()).toBe('/folder');
        act(() => probe.navigate(-1));
        expect(close).toHaveBeenCalledTimes(1);
        expect(probe.path()).toBe('/folder');
        expect(probe.stack()).toHaveLength(0);
    });

    it('pops its own entry when closed in the app', () => {
        const close = vi.fn();
        const { probe, render } = mount([{ open: false, close }]);
        render([{ open: true, close }]);
        render([{ open: false, close }]);
        expect(close).not.toHaveBeenCalled();
        expect(probe.stack()).toHaveLength(0);
        // No stale entry: Back goes to the previous screen.
        act(() => probe.navigate(-1));
        expect(probe.path()).toBe('/');
    });

    it('closes two stacked overlays in order', () => {
        const closeA = vi.fn();
        const closeB = vi.fn();
        const { probe, render } = mount([{ open: false, close: closeA }, { open: false, close: closeB }]);
        render([{ open: true, close: closeA }, { open: false, close: closeB }]);
        render([{ open: true, close: closeA }, { open: true, close: closeB }]);
        expect(probe.stack()).toHaveLength(2);
        act(() => probe.navigate(-1));
        expect(closeB).toHaveBeenCalledTimes(1);
        expect(closeA).not.toHaveBeenCalled();
        act(() => probe.navigate(-1));
        expect(closeA).toHaveBeenCalledTimes(1);
        expect(probe.path()).toBe('/folder');
    });

    it('closes without popping when a navigation replaces its entry', () => {
        const close = vi.fn();
        const { probe, render } = mount([{ open: false, close }]);
        render([{ open: true, close }]);
        expect(overlayEntryOpen({ overlays: probe.stack() })).toBe(true);
        // Picking a Search result replaces the sheet's entry with the note, and the
        // close renders before the new location does: the browser entry is already new.
        window.history.replaceState({ key: 'note' }, '');
        render([{ open: false, close }]);
        expect(probe.stack()).toHaveLength(1);
        act(() => probe.navigate('/folder/note', { replace: true }));
        window.history.replaceState(null, '');
        expect(close).toHaveBeenCalledTimes(1);
        expect(probe.path()).toBe('/folder/note');
        // No leftover sheet entry: Back returns to the screen under the sheet.
        act(() => probe.navigate(-1));
        expect(probe.path()).toBe('/folder');
        expect(probe.stack()).toHaveLength(0);
    });

    it('closes on a Back that pops its entry before the entry renders', () => {
        const close = vi.fn();
        const { probe, render } = mount([{ open: false, close }]);
        pendingPush.on = true;
        render([{ open: true, close }]);
        // Pushed but not rendered yet: a re-render keeps it open.
        render([{ open: true, close }]);
        expect(close).not.toHaveBeenCalled();
        // System Back returns to the list entry, still the rendered location.
        window.history.replaceState({ usr: null, key: 'list', idx: 1 }, '');
        render([{ open: true, close }]);
        window.history.replaceState(null, '');
        expect(close).toHaveBeenCalledTimes(1);
        expect(probe.path()).toBe('/folder');
    });

    it('closes on a quick Back to the first entry of the page, which has no key', () => {
        const close = vi.fn();
        const { render } = mount([{ open: false, close }]);
        pendingPush.on = true;
        render([{ open: true, close }]);
        window.history.replaceState({ idx: 0 }, '');
        render([{ open: true, close }]);
        window.history.replaceState(null, '');
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('keeps an overlay opened as another closes, when that one\'s Back lands later', () => {
        // Settings (its sheet, then the Purchase page on top) closes as its Unlock opens the
        // paywall, in one render. The paywall must outlive Settings' Backs.
        const closeSheet = vi.fn();
        const closePage = vi.fn();
        const closePaywall = vi.fn();
        const { probe, render } = mount([
            { open: true, close: closeSheet },
            { open: false, close: closePage },
            { open: false, close: closePaywall },
        ]);
        render([
            { open: true, close: closeSheet },
            { open: true, close: closePage },
            { open: false, close: closePaywall },
        ]);
        expect(probe.stack()).toHaveLength(2);
        laterBack.on = true;
        render([
            { open: false, close: closeSheet },
            { open: false, close: closePage },
            { open: true, close: closePaywall },
        ]);
        // Each Back lands, then the next overlay's.
        while (laterBack.queue.length) act(() => laterBack.queue.shift()!());
        expect(closePaywall).not.toHaveBeenCalled();
        expect(probe.stack()).toHaveLength(1);
        // Back closes the paywall, then leaves the screen: no entry of Settings is left.
        laterBack.on = false;
        act(() => probe.navigate(-1));
        expect(closePaywall).toHaveBeenCalledTimes(1);
        expect(probe.stack()).toHaveLength(0);
        act(() => probe.navigate(-1));
        expect(probe.path()).toBe('/');
        expect(closeSheet).not.toHaveBeenCalled();
        expect(closePage).not.toHaveBeenCalled();
    });

    it('does nothing on desktop', () => {
        window.innerWidth = 1280;
        const close = vi.fn();
        const { probe, render } = mount([{ open: false, close }]);
        render([{ open: true, close }]);
        expect(probe.stack()).toHaveLength(0);
    });
});
