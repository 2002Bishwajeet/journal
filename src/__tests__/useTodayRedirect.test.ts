// @vitest-environment happy-dom
/** #1123: `/today` (the daily reminder's `journal://today`) opens today's note. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement as h, act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom';

const { openToday, toast } = vi.hoisted(() => ({ openToday: vi.fn(), toast: { error: vi.fn() } }));
vi.mock('@/hooks/useDailyNote', () => ({ useDailyNote: () => ({ openToday }) }));
vi.mock('sonner', () => ({ toast }));

import { useTodayRedirect } from '@/hooks/useTodayRedirect';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
    const probe = { path: '', type: '' };
    function Harness() {
        const location = useLocation();
        probe.path = location.pathname;
        probe.type = useNavigationType();
        return location.pathname === '/today' ? h(Today) : null;
    }
    function Today() {
        useTodayRedirect();
        return null;
    }
    const root = createRoot(document.createElement('div'));
    await act(async () => {
        root.render(h(StrictMode, null, h(MemoryRouter, { initialEntries: ['/today'] }, h(Harness))));
    });
    return probe;
}

beforeEach(() => {
    openToday.mockReset();
    toast.error.mockReset();
});

describe('useTodayRedirect', () => {
    it("replaces /today with today's note, opening it once", async () => {
        openToday.mockResolvedValue({ docId: 'note-1', folderId: 'daily' });
        const probe = await mount();
        expect(probe.path).toBe('/daily/note-1');
        expect(probe.type).toBe('REPLACE');
        expect(openToday).toHaveBeenCalledTimes(1);
    });

    it('goes home with a message when the note cannot be opened', async () => {
        openToday.mockRejectedValue(new Error('db closed'));
        const probe = await mount();
        expect(probe.path).toBe('/');
        expect(toast.error).toHaveBeenCalledWith("Couldn't open today's note");
    });
});
