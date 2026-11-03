// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';
import { useTabRouting } from '@/hooks/useTabRouting';
import type { NoteListEntry } from '@/types';

vi.mock('@/lib/db', () => ({ getAppState: vi.fn().mockResolvedValue(null) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const notes = [
    { docId: 'a', title: 'A', metadata: { folderId: 'f' } },
    { docId: 'b', title: 'B', metadata: { folderId: 'f' } },
] as unknown as NoteListEntry[];

function mount() {
    const probe = {} as { click: (id: string) => void; path: () => string; type: () => string };
    function Harness() {
        const loc = useLocation();
        const navType = useNavigationType();
        const { handleTabClick } = useTabRouting({ noteId: 'a', folderId: 'f', notes, isNotesLoading: false });
        probe.click = handleTabClick;
        probe.path = () => loc.pathname;
        probe.type = () => navType;
        return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(h(MemoryRouter, { initialEntries: ['/f/a'] }, h(Harness))));
    return probe;
}

describe('useTabRouting handleTabClick', () => {
    it('does not push a history entry for the active tab', () => {
        const p = mount();
        act(() => p.click('a'));
        expect(p.path()).toBe('/f/a');
        // A push would report PUSH; the initial entry reports POP.
        expect(p.type()).toBe('POP');
    });

    it('pushes for another tab', () => {
        const p = mount();
        act(() => p.click('b'));
        expect(p.path()).toBe('/f/b');
        expect(p.type()).toBe('PUSH');
    });
});
