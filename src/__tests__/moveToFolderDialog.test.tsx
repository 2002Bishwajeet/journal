// @vitest-environment happy-dom
/** #826: the Move to folder picker lists the current folder on a phone and offers New folder. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import MoveToFolderDialog from '@/components/modals/MoveToFolderDialog';
import type { Folder } from '@/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

const folder = (id: string, name: string, isPublic = false) => ({ id, name, isPublic }) as Folder;

function stubSheetMode(matches: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({
        matches,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
    }));
}

async function mount(folders: Folder[]) {
    await act(async () =>
        root.render(
            createElement(MoveToFolderDialog, {
                isOpen: true,
                onClose: vi.fn(),
                noteTitle: 'Note 21',
                currentFolderId: 'a',
                folders,
                onMove: vi.fn(),
                onCreateFolder: vi.fn(async () => 'new'),
            }),
        ),
    );
}

const rows = () => [...document.querySelectorAll<HTMLButtonElement>('ul[aria-label="Folders"] button')];

beforeEach(() => {
    host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
});

describe('MoveToFolderDialog', () => {
    it('on a phone, lists the current folder as checked and disabled', async () => {
        stubSheetMode(true);
        await mount([folder('a', 'Main'), folder('b', 'Blog', true)]);
        const main = rows().find((b) => b.textContent?.includes('Main'))!;
        expect(main.disabled).toBe(true);
        expect(main.getAttribute('aria-current')).toBe('true');
        expect(document.body.textContent).toContain('Notes here are public');
        expect(rows().some((b) => b.textContent?.includes('New folder'))).toBe(true);
    });

    it('on desktop, leaves the current folder out', async () => {
        stubSheetMode(false);
        await mount([folder('a', 'Main'), folder('b', 'Blog')]);
        expect(rows().some((b) => b.textContent?.includes('Main'))).toBe(false);
    });

    it('shows a search field only with more than 8 folders', async () => {
        stubSheetMode(true);
        await mount(Array.from({ length: 8 }, (_, i) => folder(String(i), `F${i}`)));
        expect(document.querySelector('input[type="search"]')).toBeNull();
        await mount(Array.from({ length: 9 }, (_, i) => folder(String(i), `F${i}`)));
        expect(document.querySelector('input[type="search"]')).not.toBeNull();
    });
});
