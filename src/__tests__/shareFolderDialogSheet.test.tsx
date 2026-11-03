// @vitest-environment happy-dom
/** #824: Share Folder is a full sheet on a phone (Share folder in the footer) and today's dialog elsewhere. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const sheetMode = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/useSheetMode', () => ({ useSheetMode: () => sheetMode.value }));
vi.mock('@/hooks/useShareFolderDialog', () => ({
    useShareFolderDialog: () => ({
        url: 'https://app.test/share/a/f/1',
        description: 'desc',
        cardImage: undefined,
        toShare: 2,
        copy: vi.fn(),
        share: vi.fn(),
        askToStop: vi.fn(),
        publicNotes: null,
        cancelStop: vi.fn(),
        stop: vi.fn(),
    }),
}));
vi.mock('@/components/share/ShareCardPreview', () => ({ ShareCardPreview: () => null }));
import ShareFolderDialog from '@/components/modals/ShareFolderDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

beforeEach(() => {
    host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

async function open(isPublic: boolean) {
    await act(async () =>
        root.render(createElement(ShareFolderDialog, { folder: { id: 'f1', name: 'Trips', isPublic }, onClose: () => {} })),
    );
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
const shareButton = () => [...dialog().querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Share folder');

describe('ShareFolderDialog', () => {
    it('on a phone, a private folder is a sheet with Share folder in the footer', async () => {
        sheetMode.value = true;
        await open(false);
        expect(dialog().getAttribute('data-slot')).toBe('sheet-content');
        expect(shareButton()!.closest('[data-slot="sheet-footer"]')).not.toBeNull();
    });

    it('on a phone, a public folder has no footer; Copy link and Stop sharing stay in the body', async () => {
        sheetMode.value = true;
        await open(true);
        expect(dialog().getAttribute('data-slot')).toBe('sheet-content');
        expect(dialog().querySelector('[data-slot="sheet-footer"]')).toBeNull();
        expect(shareButton()).toBeUndefined();
        expect(dialog().textContent).toContain('Copy link');
        expect(dialog().textContent).toContain('Stop sharing (make private)');
    });

    it('elsewhere it is the dialog, with Share folder in the body', async () => {
        sheetMode.value = false;
        await open(false);
        expect(dialog().getAttribute('data-slot')).toBe('dialog-content');
        expect(dialog().querySelector('[data-slot="sheet-footer"]')).toBeNull();
        expect(shareButton()).toBeDefined();
    });
});
