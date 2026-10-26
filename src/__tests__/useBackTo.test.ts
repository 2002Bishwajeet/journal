// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { useBackTo } from '@/hooks/useBackTo';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Probe = { backTo: (p: string) => void; navigate: ReturnType<typeof useNavigate>; path: () => string };

function mount(initial: string[]) {
    const probe = {} as Probe;
    function Harness() {
        const loc = useLocation();
        probe.backTo = useBackTo();
        probe.navigate = useNavigate();
        probe.path = () => loc.pathname;
        return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(h(MemoryRouter, { initialEntries: initial }, h(Harness))));
    return probe;
}

describe('useBackTo', () => {
    it('goes back to the previous entry', () => {
        const p = mount(['/']);
        act(() => p.navigate('/folder'));
        act(() => p.navigate('/folder/note'));
        act(() => p.backTo('/folder'));
        expect(p.path()).toBe('/folder');
        // One entry back, not a new push: the next back reaches the start.
        act(() => p.navigate(-1));
        expect(p.path()).toBe('/');
    });

    it('replaces with the parent on the first entry', () => {
        const p = mount(['/folder/note']);
        act(() => p.backTo('/folder'));
        expect(p.path()).toBe('/folder');
        act(() => p.navigate(-1));
        expect(p.path()).toBe('/folder');
    });
});
