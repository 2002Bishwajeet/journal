// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useSidebarCollapse } from '@/hooks/useSidebarCollapse';
import { SIDEBAR_COLLAPSE_KEY } from '@/lib/storage';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function mount() {
    const result = { current: null as unknown as ReturnType<typeof useSidebarCollapse> };
    function Probe() {
        result.current = useSidebarCollapse();
        return null;
    }
    act(() => createRoot(document.createElement('div')).render(h(Probe)));
    return result;
}

describe('useSidebarCollapse', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('defaults to everything expanded', () => {
        expect(mount().current.collapsed).toEqual({ sidebar: false, folders: false, tags: false });
    });

    it('toggles one part without touching the others', () => {
        const r = mount();
        act(() => r.current.toggle('tags'));
        expect(r.current.collapsed).toEqual({ sidebar: false, folders: false, tags: true });
        act(() => r.current.toggle('tags'));
        expect(r.current.collapsed.tags).toBe(false);
    });

    it('persists across a remount', () => {
        const r = mount();
        act(() => r.current.toggle('folders'));
        act(() => r.current.toggle('sidebar'));
        expect(mount().current.collapsed).toEqual({ sidebar: true, folders: true, tags: false });
    });

    it('treats malformed stored data as expanded', () => {
        localStorage.setItem(SIDEBAR_COLLAPSE_KEY, '{"tags":"yes"');
        expect(mount().current.collapsed).toEqual({ sidebar: false, folders: false, tags: false });
    });

    it('stays expanded and still toggles in memory when storage throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const r = mount();
        expect(r.current.collapsed).toEqual({ sidebar: false, folders: false, tags: false });
        act(() => r.current.toggle('tags'));
        expect(r.current.collapsed.tags).toBe(true);
    });
});
