// @vitest-environment happy-dom
/**
 * useChatSession holds the ChatBot panel's state and behaviour (issue #233):
 * per-note history, command autocomplete, and web-search consent gating.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

const { mockChat, mockWebSearch } = vi.hoisted(() => ({
    mockChat: vi.fn(async () => 'ai response'),
    mockWebSearch: vi.fn(async () => []),
}));

vi.mock('@/hooks/useWebLLM', () => ({
    useWebLLM: () => ({
        chat: mockChat,
        isReady: true,
        initialize: vi.fn(),
        isLoading: false,
        loadingProgress: 0,
        loadingMessage: '',
    }),
}));
vi.mock('@/hooks/useNotes', () => ({
    useNotes: () => ({ get: { data: [] } }),
}));
vi.mock('@/lib/db', () => ({
    getSearchIndexEntry: vi.fn(async () => null),
}));
vi.mock('@/lib/search/searchService', () => ({
    webSearch: mockWebSearch,
}));

import { useChatSession } from '@/hooks/useChatSession';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    localStorage.clear();
    mockChat.mockClear();
    mockWebSearch.mockClear();
});

type Session = ReturnType<typeof useChatSession>;

/** Mounts useChatSession and keeps `latest.current` pointed at its newest return value. */
function mountSession() {
    const latest: { current: Session | null } = { current: null };
    function Harness({ noteId }: { noteId: string | undefined }) {
        latest.current = useChatSession(noteId);
        return null;
    }

    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    const render = (noteId: string | undefined) =>
        act(async () => { root.render(h(Harness, { noteId })); });
    const cleanup = async () => {
        await act(async () => root.unmount());
        el.remove();
    };

    return { latest, render, cleanup };
}

describe('useChatSession — per-note history', () => {
    it('keeps history separate per note id and restores it when switching back', async () => {
        const { latest, render, cleanup } = mountSession();
        await render('note-a');

        await act(async () => { latest.current!.setInput('/help'); });
        await act(async () => { await latest.current!.send(); });

        expect(latest.current!.messages).toHaveLength(2);
        expect(latest.current!.messages[0]).toMatchObject({ role: 'user', content: '/help' });

        await render('note-b');
        expect(latest.current!.messages).toEqual([]);

        await render('note-a');
        expect(latest.current!.messages).toHaveLength(2);

        await cleanup();
    });
});

describe('useChatSession — command suggestions', () => {
    it('opens on "/" and filters to matching commands as more is typed', async () => {
        const { latest, render, cleanup } = mountSession();
        await render('note-a');

        await act(async () => { latest.current!.setInput('/'); });
        expect(latest.current!.suggestions.open).toBe(true);
        expect(latest.current!.suggestions.items.map((c) => c.label)).toEqual([
            '/summarize',
            '/search',
            '/clear',
            '/help',
        ]);

        await act(async () => { latest.current!.setInput('/se'); });
        expect(latest.current!.suggestions.items.map((c) => c.label)).toEqual(['/search']);

        await cleanup();
    });
});

describe('useChatSession — web-search consent', () => {
    it('/search without prior consent opens the consent prompt and never calls webSearch', async () => {
        const { latest, render, cleanup } = mountSession();
        await render('note-a');

        await act(async () => { latest.current!.setInput('/search latest AI news'); });
        await act(async () => { await latest.current!.send(); });

        expect(latest.current!.consent.open).toBe(true);
        expect(latest.current!.consent.query).toBe('latest AI news');
        expect(mockWebSearch).not.toHaveBeenCalled();

        await cleanup();
    });
});
