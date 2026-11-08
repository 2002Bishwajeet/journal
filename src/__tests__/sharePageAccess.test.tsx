// @vitest-environment happy-dom
/**
 * What the share page shows when there is no public note (#1002): "no access" for a
 * note that isn't public (with Sign in when signed out; signed in, the app tries to
 * open it), and "not found" for a missing one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { page } = vi.hoisted(() => ({ page: { current: {} as Record<string, unknown> } }));
vi.mock('@/hooks/useSharePage', () => ({ useSharePage: () => page.current }));

import SharePage from '@/pages/SharePage';

const OPEN_SHARED = '/open-shared?identity=owner.example.com&file=4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34';

function state(overrides: Record<string, unknown>) {
    return {
        identity: 'owner.example.com',
        noteId: '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34',
        note: undefined,
        isLoading: false,
        error: null,
        forbidden: false,
        isAuthenticated: false,
        openSharedHref: OPEN_SHARED,
        author: { name: 'Owner' },
        readingMinutes: 0,
        cover: undefined,
        ...overrides,
    };
}

function Where() {
    const location = useLocation();
    return createElement('p', { 'data-testid': 'where' }, location.pathname + location.search);
}

let el: HTMLElement;
let root: Root;

async function mount() {
    await act(async () => {
        root.render(createElement(MemoryRouter, { initialEntries: ['/share/owner.example.com/note'] },
            createElement(Routes, null,
                createElement(Route, { path: '/share/:identity/:noteId', element: createElement(SharePage) }),
                createElement(Route, { path: '/open-shared', element: createElement(Where) }),
            )));
    });
}

const heading = () => el.querySelector('h1')?.textContent;
const link = (name: string) => [...el.querySelectorAll('a')].find((a) => a.textContent?.trim() === name);

beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
});

afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

describe('SharePage without a public note', () => {
    it('tells a signed-out visitor they have no access, with Sign in to the in-app route', async () => {
        page.current = state({ error: new Error('This note is not shared publicly.'), forbidden: true });
        await mount();

        expect(heading()).toBe("You don't have access to this note");
        expect(link('Sign in')?.getAttribute('href')).toBe(OPEN_SHARED);
    });

    it('sends a signed-in viewer to the app, which opens the note when it was shared with them', async () => {
        page.current = state({ error: new Error('This note is not shared publicly.'), forbidden: true, isAuthenticated: true });
        await mount();

        expect(el.querySelector('[data-testid="where"]')?.textContent).toBe(OPEN_SHARED);
    });

    it('says not found for a missing note, with no Sign in', async () => {
        page.current = state({ error: new Error('Note not found or is not public') });
        await mount();

        expect(heading()).toBe('Note not found');
        expect(link('Sign in')).toBeUndefined();
    });
});
