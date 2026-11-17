// @vitest-environment happy-dom
/**
 * A new active outline heading re-renders the share page; the article's images, links
 * and tables must stay mounted, or every image reloads and the page height jumps (#1356).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { page, outline, mounts } = vi.hoisted(() => ({
    page: { current: {} as Record<string, unknown> },
    outline: { setActiveId: (() => {}) as (id: string) => void },
    mounts: { image: 0 },
}));
vi.mock('@/hooks/useSharePage', () => ({ useSharePage: () => page.current }));
vi.mock('@/hooks/useShareOutline', () => ({
    useShareOutline: () => {
        const [activeId, setActiveId] = useState('first');
        outline.setActiveId = setActiveId;
        return { headings: [], activeId, hidden: false, toggleHidden: () => {} };
    },
}));
vi.mock('@/components/share/PublicNoteImage', () => ({
    PublicNoteImage: ({ src, alt }: { src: string; alt?: string }) => {
        useEffect(() => {
            mounts.image++;
        }, []);
        return createElement('img', { src, alt, 'data-testid': 'public-image' });
    },
}));

import SharePage from '@/pages/SharePage';

const CONTENT = [
    '## First',
    '',
    '![Attached](attachment://4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34/img1)',
    '',
    '## Second',
    '',
    '![Remote](https://example.com/a.png) and a [link](https://example.com)',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '## Third',
].join('\n');

let el: HTMLElement;
let root: Root;

beforeEach(() => {
    mounts.image = 0;
    page.current = {
        identity: 'owner.example.com',
        noteId: '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34',
        note: {
            fileId: '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34',
            title: 'Long note',
            content: CONTENT,
            createdAt: '2026-11-01T00:00:00Z',
            updatedAt: '2026-11-01T00:00:00Z',
            lastModified: 1,
        },
        isLoading: false,
        error: null,
        forbidden: false,
        isAuthenticated: false,
        openSharedHref: undefined,
        author: { name: 'Owner' },
        readingMinutes: 1,
        cover: undefined,
    };
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
});

afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

describe('SharePage outline', () => {
    it('keeps the article images, links and tables mounted when the active heading changes', async () => {
        await act(async () => {
            root.render(
                createElement(
                    MemoryRouter,
                    { initialEntries: ['/share/owner.example.com/note'] },
                    createElement(Routes, null, createElement(Route, { path: '/share/:identity/:noteId', element: createElement(SharePage) })),
                ),
            );
        });
        const attached = el.querySelector('[data-testid="public-image"]');
        const remote = el.querySelector('img[src="https://example.com/a.png"]');
        const link = el.querySelector('a[href="https://example.com"]');
        const table = el.querySelector('table');
        expect(attached && remote && link && table).toBeTruthy();
        expect(mounts.image).toBe(1);

        for (const id of ['second', 'third', 'second', 'third']) {
            await act(async () => outline.setActiveId(id));
        }

        expect(mounts.image).toBe(1);
        expect(el.querySelector('[data-testid="public-image"]')).toBe(attached);
        expect(el.querySelector('img[src="https://example.com/a.png"]')).toBe(remote);
        expect(el.querySelector('a[href="https://example.com"]')).toBe(link);
        expect(el.querySelector('table')).toBe(table);
    });
});
