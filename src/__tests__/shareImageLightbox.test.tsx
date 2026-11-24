// @vitest-environment happy-dom
/**
 * #1357: on the share page a tap, click or Enter on an image opens it full size in the
 * editor's lightbox, with the src the page loaded (the public payload's object URL).
 * A drag across a carousel doesn't open it, nor does a linked image; Esc closes it.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/components/share/PublicNoteImage', () => ({
    // The object URL PublicNoteImage would make from the guest payload
    PublicNoteImage: ({ src, alt, className }: { src: string; alt?: string; className?: string }) =>
        createElement('img', { src: `blob:${src.split('/').pop()}`, alt, className }),
}));
vi.mock('@/components/OdinImage/OdinImage', () => ({ OdinImage: () => null }));
vi.mock('@/lib/db', () => ({ getLocalImageBytes: async () => null, getPendingImageUpload: async () => null }));
vi.mock('@/hooks/usePeerAccess', () => ({ usePeerAccess: () => true }));

import { ShareNoteMarkdown } from '@/components/share/ShareNoteMarkdown';

const NOTE = '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34';
const img = (alt: string, key: string) => `![${alt}](attachment://${NOTE}/${key})`;
const gallery = (layout: string) => `<div data-gallery="${layout}">\n\n${img('Wide', 'jrnl_img1')} ${img('Tall', 'jrnl_img2')}\n\n</div>`;

let el: HTMLElement;
let root: Root;

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

async function render(content: string) {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
        root.render(createElement(ShareNoteMarkdown, { content, identity: 'owner.example.com', noteFileId: NOTE, lastModified: 1 }));
    });
}

const opener = (name: string) => el.querySelector(`[role="button"][aria-label="${name}, view full size"]`) as HTMLElement;
const dialogImg = () => document.body.querySelector('[role="dialog"] img');

async function press(target: HTMLElement, from: number, to: number) {
    await act(async () => {
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: from, clientY: 10 }));
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: to, clientY: 10 }));
    });
}

describe('share page image lightbox', () => {
    it('opens a single image full size with its public src', async () => {
        await render(`Before\n\n${img('Kite', 'jrnl_img0')}\n\nAfter`);
        await press(opener('Kite'), 40, 40);
        await vi.waitFor(() => expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img0'));
    });

    it('opens the grid tile that was clicked', async () => {
        await render(gallery('grid'));
        expect(el.querySelector('[data-gallery="grid"]')).not.toBeNull();
        await press(opener('Tall'), 40, 40);
        await vi.waitFor(() => expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img2'));
    });

    it('does not open when a carousel is dragged, and opens on a tap', async () => {
        await render(gallery('carousel'));
        const slide = opener('Wide');
        await press(slide, 200, 60);
        // The lazy viewer would have had time to load
        await act(async () => new Promise((r) => setTimeout(r, 50)));
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();

        await press(slide, 60, 63);
        await vi.waitFor(() => expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img1'));
    });

    it('leaves a linked image to its link: no button, tab stop or zoom cursor', async () => {
        await render(`[${img('Kite', 'jrnl_img0')}](https://example.com/kite)`);
        const link = el.querySelector('a[href="https://example.com/kite"]') as HTMLElement;
        const box = link.querySelector('.share-img') as HTMLElement;
        expect(box).not.toBeNull();
        expect(el.querySelector('[role="button"]')).toBeNull();
        expect(box.hasAttribute('tabindex')).toBe(false);
        expect(box.hasAttribute('aria-label')).toBe(false);
        expect(box.classList.contains('cursor-zoom-in')).toBe(false);
        await press(box, 40, 40);
        await act(async () => new Promise((r) => setTimeout(r, 50)));
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });

    it('opens on Enter and closes on Escape', async () => {
        await render(img('Kite', 'jrnl_img0'));
        const target = opener('Kite');
        expect(target.tabIndex).toBe(0);
        await act(async () => {
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });
        await vi.waitFor(() => expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img0'));

        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());
    });
});
