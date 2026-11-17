// @vitest-environment happy-dom
/**
 * An open share page follows the OS light/dark switch live (#1370), unless the app's
 * stored theme is Light or Dark. The article stays mounted when the theme flips.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { mounts } = vi.hoisted(() => ({ mounts: { image: 0 } }));
vi.mock('@/hooks/useSharePage', () => ({
    useSharePage: () => ({
        identity: 'owner.example.com',
        noteId: '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34',
        note: {
            fileId: '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34',
            title: 'Themed note',
            content: '![Attached](attachment://4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34/img1)',
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
    }),
}));
vi.mock('@/hooks/useShareOutline', () => ({
    useShareOutline: () => ({ headings: [], activeId: '', hidden: false, toggleHidden: () => {} }),
}));
vi.mock('@/components/share/PublicNoteImage', () => ({
    PublicNoteImage: ({ src, alt }: { src: string; alt?: string }) => {
        useEffect(() => {
            mounts.image++;
        }, []);
        return createElement('img', { src, alt });
    },
}));

import SharePage from '@/pages/SharePage';

let systemDark = false;
const listeners = new Set<() => void>();
let el: HTMLElement;
let root: Root;

async function openPage() {
    await act(async () => {
        root.render(
            createElement(
                MemoryRouter,
                { initialEntries: ['/share/owner.example.com/n'] },
                createElement(Routes, null, createElement(Route, { path: '/share/:identity/:noteId', element: createElement(SharePage) })),
            ),
        );
    });
}

async function switchOsTo(dark: boolean) {
    systemDark = dark;
    await act(async () => listeners.forEach((fn) => fn()));
}

const html = document.documentElement;

beforeEach(() => {
    systemDark = false;
    mounts.image = 0;
    listeners.clear();
    localStorage.clear();
    html.className = 'light';
    vi.spyOn(window, 'matchMedia').mockImplementation(
        (query: string) =>
            ({
                get matches() {
                    return systemDark;
                },
                media: query,
                addEventListener: (_: string, fn: () => void) => listeners.add(fn),
                removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
            }) as unknown as MediaQueryList,
    );
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
});

afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
    vi.restoreAllMocks();
});

describe('SharePage theme', () => {
    it('follows the OS scheme live, without remounting the article', async () => {
        await openPage();
        expect(html.classList.contains('light')).toBe(true);
        expect(mounts.image).toBe(1);

        await switchOsTo(true);
        expect(html.classList.contains('dark')).toBe(true);
        expect(html.classList.contains('light')).toBe(false);
        expect(html.style.colorScheme).toBe('dark');

        await switchOsTo(false);
        expect(html.classList.contains('light')).toBe(true);
        expect(mounts.image).toBe(1);
    });

    it('keeps an explicit stored theme when the OS scheme changes', async () => {
        localStorage.setItem('journal-theme-preference', 'light');
        await openPage();

        await switchOsTo(true);
        expect(html.classList.contains('light')).toBe(true);
        expect(html.classList.contains('dark')).toBe(false);
    });

    it('leaves the html class alone when it already shows the theme', async () => {
        const observer = new MutationObserver(() => {});
        observer.observe(html, { attributes: true, attributeFilter: ['class'] });

        await openPage();
        expect(observer.takeRecords()).toHaveLength(0);
        observer.disconnect();
    });
});
