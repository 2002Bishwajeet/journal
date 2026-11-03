// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { useMobileTabs } from '@/hooks/useMobileTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Probe = { tabs: ReturnType<typeof useMobileTabs>; navigate: ReturnType<typeof useNavigate>; path: () => string };

let mounted: Root | undefined;

function mount(start: string) {
    mounted?.unmount();
    window.history.replaceState(null, '', start);
    const probe = {} as Probe;
    function Harness() {
        const loc = useLocation();
        probe.tabs = useMobileTabs();
        probe.navigate = useNavigate();
        probe.path = () => loc.pathname + loc.search;
        return null;
    }
    mounted = createRoot(document.createElement('div'));
    act(() => mounted!.render(h(BrowserRouter, null, h(Harness))));
    return probe;
}

// BrowserRouter hears a history pop through popstate, which happy-dom fires asynchronously.
const settle = (fn: () => void) => act(async () => { fn(); await new Promise((r) => setTimeout(r, 20)); });
const stack = (tab: string) => (JSON.parse(sessionStorage.getItem('journal-tab-stacks') ?? '{}') as Record<string, string[]>)[tab];

beforeEach(() => sessionStorage.clear());

describe('useMobileTabs back stacks', () => {
    it('keeps each tab\'s screens and rebuilds them on a switch, so Back walks that tab', async () => {
        const p = mount('/');
        await settle(() => p.navigate('/projects'));
        await settle(() => p.navigate('/projects/note-1'));
        expect(stack('notes')).toEqual(['/', '/projects', '/projects/note-1']);

        await settle(() => p.tabs.selectTab('shared'));
        expect(p.path()).toBe('/shared');

        await settle(() => p.tabs.selectTab('notes'));
        expect(p.path()).toBe('/projects/note-1');
        expect(stack('notes')).toEqual(['/', '/projects', '/projects/note-1']);

        await settle(() => p.navigate(-1));
        expect(p.path()).toBe('/projects');
        expect(stack('notes')).toEqual(['/', '/projects']);
        await settle(() => p.navigate(-1));
        expect(p.path()).toBe('/');
        expect(stack('notes')).toEqual(['/']);
    });

    it('pops the active tab to its root and clears its stack', async () => {
        const p = mount('/');
        await settle(() => p.navigate('/projects'));
        await settle(() => p.navigate('/projects/note-1'));
        await settle(() => p.tabs.selectTab('notes'));
        expect(p.path()).toBe('/');
        expect(stack('notes')).toEqual(['/']);
    });

    it('puts a deep link on the stack of its own tab', async () => {
        const p = mount('/shared/note-9');
        expect(p.tabs.activeTab).toBe('shared');
        expect(stack('shared')).toEqual(['/shared/note-9']);
        expect(stack('notes')).toEqual([]);
    });

    it('never puts a sheet\'s entry on a stack', async () => {
        const p = mount('/');
        await settle(() => p.navigate('/projects'));
        await settle(() => p.navigate('/projects', { state: { overlays: ['sheet'] } }));
        expect(stack('notes')).toEqual(['/', '/projects']);
        await settle(() => p.navigate(-1));
        expect(stack('notes')).toEqual(['/', '/projects']);
        // A result picked in a sheet replaces the sheet's entry; the entry under it stays in history.
        await settle(() => p.navigate('/projects', { state: { overlays: ['sheet'] } }));
        await settle(() => p.navigate('/projects/note-2', { replace: true }));
        expect(stack('notes')).toEqual(['/', '/projects', '/projects/note-2']);
    });

    it('restores the stack after a reload in the middle of it', async () => {
        const p = mount('/');
        await settle(() => p.navigate('/projects'));
        await settle(() => p.navigate('/projects/note-1'));
        await settle(() => p.navigate(-1));
        // The reload keeps both the browser's history and sessionStorage; a new mount reads them.
        const reloaded = mount('/projects');
        expect(reloaded.path()).toBe('/projects');
        expect(stack('notes')).toEqual(['/', '/projects']);
    });

    it('starts over when the saved stack does not match the browser entry', async () => {
        sessionStorage.setItem('journal-tab-stacks', JSON.stringify({ notes: ['/', '/old'], shared: [] }));
        mount('/projects');
        expect(stack('notes')).toEqual(['/projects']);
    });
});
