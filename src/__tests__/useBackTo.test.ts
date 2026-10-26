// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';
import { useBackTo } from '@/hooks/useBackTo';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Probe = { backTo: (p: string) => void; navigate: ReturnType<typeof useNavigate>; path: () => string };

function mount(start: string) {
    window.history.replaceState(null, '', start);
    const probe = {} as Probe;
    function Harness() {
        const loc = useLocation();
        probe.backTo = useBackTo();
        probe.navigate = useNavigate();
        probe.path = () => loc.pathname;
        return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(h(BrowserRouter, null, h(Harness))));
    return probe;
}

// BrowserRouter hears a history pop through popstate, which happy-dom fires asynchronously.
const settle = (fn: () => void) => act(async () => { fn(); await new Promise((r) => setTimeout(r, 20)); });

describe('useBackTo', () => {
    it('goes back to the previous entry', async () => {
        const p = mount('/');
        await settle(() => p.navigate('/folder'));
        await settle(() => p.navigate('/folder/note'));
        await settle(() => p.backTo('/folder'));
        expect(p.path()).toBe('/folder');
        // One entry back, not a new push: the next back reaches the start.
        await settle(() => p.navigate(-1));
        expect(p.path()).toBe('/');
    });

    it('replaces with the parent on the first entry, also after a replace', async () => {
        // Session restore redirects a fresh load with a replace: still the first entry.
        const p = mount('/');
        await settle(() => p.navigate('/folder/note', { replace: true }));
        await settle(() => p.backTo('/folder'));
        expect(p.path()).toBe('/folder');
        expect((window.history.state as { idx?: number }).idx).toBe(0);
    });
});
