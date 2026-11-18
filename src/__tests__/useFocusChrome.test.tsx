// @vitest-environment happy-dom
/** Focus mode's exit pill: shows on entering, then only on a deliberate action (#1391). */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { act, createElement as h, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useFocusChrome, FOCUS_PEEK_MS, FOCUS_SHOW_MS, FOCUS_EDGE_PX, FOCUS_ZONE_PX } from '@/hooks/useFocusChrome';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const seen = {} as { api: ReturnType<typeof useFocusChrome> };
const api = {
    get shown() {
        return seen.api.shown;
    },
    reveal: () => seen.api.reveal(),
};
function Probe({ active }: { active: boolean }) {
    const result = useFocusChrome(active);
    useEffect(() => {
        seen.api = result;
    });
    return null;
}

async function mount(active: boolean) {
    const root = createRoot(document.createElement('div'));
    const render = (next: boolean) => act(async () => root.render(h(Probe, { active: next })));
    await render(active);
    return { render, unmount: () => act(async () => root.unmount()) };
}

const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms));
const pointer = (type: string, init: { clientY: number; pointerType?: string }) =>
    act(async () => {
        const event = new Event(type, { bubbles: true });
        Object.assign(event, { pointerType: 'mouse', ...init });
        window.dispatchEvent(event);
    });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

describe('useFocusChrome', () => {
    it('shows on entering focus mode, then hides', async () => {
        const { render, unmount } = await mount(false);
        expect(api.shown).toBe(false);

        await render(true);
        expect(api.shown).toBe(true);
        await wait(FOCUS_PEEK_MS - 1);
        expect(api.shown).toBe(true);
        await wait(1);
        expect(api.shown).toBe(false);
        await unmount();
    });

    it('stays hidden when focus mode is off, and listens to nothing', async () => {
        const { unmount } = await mount(false);
        await pointer('pointermove', { clientY: 0 });
        expect(api.shown).toBe(false);
        await unmount();
    });

    it('comes back for a mouse at the top edge, and hides again after a few idle seconds', async () => {
        const { unmount } = await mount(true);
        await wait(FOCUS_PEEK_MS);
        expect(api.shown).toBe(false);

        await pointer('pointermove', { clientY: FOCUS_EDGE_PX + 1 });
        expect(api.shown).toBe(false);
        await pointer('pointermove', { clientY: FOCUS_EDGE_PX });
        expect(api.shown).toBe(true);
        await wait(FOCUS_SHOW_MS);
        expect(api.shown).toBe(false);
        await unmount();
    });

    it('stays while the pointer works in the revealed chrome', async () => {
        const { unmount } = await mount(true);
        await wait(FOCUS_PEEK_MS);
        await pointer('pointermove', { clientY: 0 });
        await wait(FOCUS_SHOW_MS - 1);
        await pointer('pointermove', { clientY: FOCUS_ZONE_PX });
        await wait(FOCUS_SHOW_MS - 1);
        expect(api.shown).toBe(true);
        await wait(1);
        expect(api.shown).toBe(false);
        await unmount();
    });

    it('does not reveal for a pointer in the note, a touch near the edge, scrolling or typing', async () => {
        const { unmount } = await mount(true);
        await wait(FOCUS_PEEK_MS);

        await pointer('pointermove', { clientY: FOCUS_ZONE_PX });
        await pointer('pointerdown', { clientY: 0, pointerType: 'touch' });
        await act(async () => {
            window.dispatchEvent(new Event('scroll'));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
        });
        expect(api.shown).toBe(false);
        await unmount();
    });

    it('reveal() shows it for a touch device tapping the top strip', async () => {
        const { unmount } = await mount(true);
        await wait(FOCUS_PEEK_MS);
        expect(api.shown).toBe(false);

        await act(async () => api.reveal());
        expect(api.shown).toBe(true);
        await wait(FOCUS_SHOW_MS);
        expect(api.shown).toBe(false);
        await unmount();
    });

    it('waits for an open menu before hiding', async () => {
        const { unmount } = await mount(true);
        await wait(FOCUS_PEEK_MS);
        await pointer('pointermove', { clientY: 0 });
        const menu = document.body.appendChild(document.createElement('div'));
        menu.setAttribute('role', 'menu');

        await wait(FOCUS_SHOW_MS * 2);
        expect(api.shown).toBe(true);
        menu.remove();
        await wait(FOCUS_SHOW_MS);
        expect(api.shown).toBe(false);
        await unmount();
    });

    it('is hidden at once when focus mode ends', async () => {
        const { render, unmount } = await mount(true);
        expect(api.shown).toBe(true);
        await render(false);
        expect(api.shown).toBe(false);
        await unmount();
    });
});
