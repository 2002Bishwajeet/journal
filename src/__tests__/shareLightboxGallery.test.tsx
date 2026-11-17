// @vitest-environment happy-dom
/**
 * #1369: on the share page, a lightbox opened from a gallery image steps through that
 * gallery's images with the arrow keys or its labelled buttons, shows "2 / 5", stops at
 * the ends, preloads the neighbours, and gives each image its own edits. A single image
 * shows no controls.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/components/share/PublicNoteImage', () => ({
    PublicNoteImage: ({ src, alt, className }: { src: string; alt?: string; className?: string }) =>
        createElement('img', { src: `blob:${src.split('/').pop()}`, alt, className }),
}));
vi.mock('@/components/OdinImage/OdinImage', () => ({ OdinImage: () => null }));
vi.mock('@/lib/db', () => ({ getLocalImageBytes: async () => null, getPendingImageUpload: async () => null }));

import { ShareNoteMarkdown } from '@/components/share/ShareNoteMarkdown';

const NOTE = '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34';
const img = (alt: string, key: string) => `![${alt}](attachment://${NOTE}/${key})`;
const gallery3 = (layout: string) =>
    `<div data-gallery="${layout}">\n\n${img('Wide', 'jrnl_img1')} ${img('Tall', 'jrnl_img2')} ${img('Square', 'jrnl_img3')}\n\n</div>`;

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
const hiddenSrcs = () => [...document.body.querySelectorAll('[role="dialog"] [aria-hidden] img')].map((i) => i.getAttribute('src'));
const position = () => document.body.querySelector('[role="dialog"] [aria-live="polite"]')?.textContent;
const stepButton = (name: string) => document.body.querySelector(`[role="dialog"] button[aria-label="${name}"]`) as HTMLButtonElement | null;

async function open(name: string) {
    await act(async () => {
        const target = opener(name);
        target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 10 }));
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 40, clientY: 10 }));
    });
}

const key = (name: string) =>
    act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    });

describe('share page lightbox through a gallery', () => {
    it('steps with the arrow keys, shows the position and stops at the ends', async () => {
        await render(gallery3('grid'));
        await open('Tall');
        await vi.waitFor(() => expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img2'));
        expect(position()).toBe('2 / 3');

        await key('ArrowRight');
        expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img3');
        expect(position()).toBe('3 / 3');
        expect(stepButton('Next image')!.disabled).toBe(true);

        await key('ArrowRight');
        expect(position()).toBe('3 / 3');

        await key('ArrowLeft');
        await key('ArrowLeft');
        await key('ArrowLeft');
        expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img1');
        expect(position()).toBe('1 / 3');
        expect(stepButton('Previous image')!.disabled).toBe(true);
    });

    it('steps with the labelled buttons and preloads the neighbours unseen', async () => {
        await render(gallery3('carousel'));
        await open('Wide');
        await vi.waitFor(() => expect(stepButton('Next image')).not.toBeNull());
        expect(hiddenSrcs()).toEqual(['blob:jrnl_img2']);

        await act(async () => stepButton('Next image')!.click());
        expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img2');
        expect(position()).toBe('2 / 3');
        expect(hiddenSrcs()).toEqual(['blob:jrnl_img1', 'blob:jrnl_img3']);

        await act(async () => stepButton('Previous image')!.click());
        expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img1');
    });

    it('starts at the opened image again after closing', async () => {
        await render(gallery3('row'));
        await open('Wide');
        await vi.waitFor(() => expect(position()).toBe('1 / 3'));
        await key('ArrowRight');
        expect(position()).toBe('2 / 3');
        await key('Escape');
        await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());

        await open('Wide');
        await vi.waitFor(() => expect(position()).toBe('1 / 3'));
    });

    it('draws the stepped-to image with its own edits', async () => {
        const edited = `<img src="attachment://${NOTE}/jrnl_img2" alt="Tall" data-rotate="90">`;
        await render(`<div data-gallery="row">\n\n${img('Wide', 'jrnl_img1')} ${edited}\n\n</div>`);
        await open('Wide');
        await vi.waitFor(() => expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img1'));
        expect(document.body.querySelector('[data-testid="lightbox-zoom"] [data-testid="edited-image"]')).toBeNull();
        await key('ArrowRight');
        expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img2');
        expect(document.body.querySelector('[data-testid="lightbox-zoom"] [data-testid="edited-image"]')).not.toBeNull();
    });

    it('shows no controls for a single image, or one alone in a gallery', async () => {
        await render(`${img('Kite', 'jrnl_img0')}\n\n<div data-gallery="row">\n\n${img('Alone', 'jrnl_img1')}\n\n</div>`);
        await open('Kite');
        await vi.waitFor(() => expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img0'));
        expect(position()).toBeUndefined();
        expect(stepButton('Next image')).toBeNull();
        expect(hiddenSrcs()).toEqual([]);
        await key('ArrowRight');
        expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img0');
        await key('Escape');
        await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeNull());

        await open('Alone');
        await vi.waitFor(() => expect(dialogImg()?.getAttribute('src')).toBe('blob:jrnl_img1'));
        expect(stepButton('Previous image')).toBeNull();
    });
});
