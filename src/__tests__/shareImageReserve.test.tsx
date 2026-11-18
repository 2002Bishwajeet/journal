// @vitest-environment happy-dom
/**
 * #1387: on the share page an image holds its box from the first paint: the size stored in
 * the markdown (data-width / data-height), else the note file's header, and its tiny
 * thumbnail shows until the bytes arrive. Nothing opens full size from the placeholder.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/lib/db', () => ({ getLocalImageBytes: async () => null, getPendingImageUpload: async () => null }));
// The guest payload never arrives in these tests: the placeholder is what shows
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/core')>()),
    getPayloadBytes: () => new Promise(() => {}),
}));

import { ShareNoteMarkdown } from '@/components/share/ShareNoteMarkdown';

const NOTE = '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34';
const tiny = { contentType: 'image/jpeg' as const, content: 'AAAA', pixelWidth: 20, pixelHeight: 11 };

let el: HTMLElement;
let root: Root;

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
});

async function render(content: string, imagePreviews?: Record<string, unknown>) {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
        root.render(createElement(ShareNoteMarkdown, { content, identity: 'owner.example.com', noteFileId: NOTE, lastModified: 1, imagePreviews: imagePreviews as never }));
    });
}

const placeholder = () => el.querySelector('[data-testid="image-placeholder"]');

describe('share page image placeholder', () => {
    it('holds the size stored in the markdown, with the header\'s tiny thumbnail', async () => {
        await render(`<img src="attachment://${NOTE}/jrnl_img0" alt="Kite" data-width="1600" data-height="900">`, { jrnl_img0: { thumb: tiny } });
        expect(placeholder()?.getAttribute('width')).toBe('1600');
        expect(placeholder()?.getAttribute('height')).toBe('900');
        expect(placeholder()?.getAttribute('src')).toBe('data:image/jpeg;base64,AAAA');
        expect(placeholder()?.getAttribute('aria-hidden')).toBe('true');
    });

    it('takes the size from the note file\'s header for a note from before', async () => {
        await render(`![Kite](attachment://${NOTE}/jrnl_img0)`, { jrnl_img0: { thumb: tiny, size: { width: 1280, height: 720 } } });
        expect(placeholder()?.getAttribute('width')).toBe('1280');
        expect(placeholder()?.getAttribute('height')).toBe('720');
    });

    it('sets a gallery item\'s aspect ratio at once, not when its image loads', async () => {
        await render(
            `<div data-gallery="row">\n\n<img src="attachment://${NOTE}/jrnl_img0" alt="Wide" data-width="1600" data-height="800"> <img src="attachment://${NOTE}/jrnl_img1" alt="Tall" data-width="600" data-height="800">\n\n</div>`,
        );
        const items = [...el.querySelectorAll<HTMLElement>('[data-gallery] > .share-img')];
        expect(items.map((item) => item.style.getPropertyValue('--ar'))).toEqual(['2', '0.75']);
    });

    it('gives a plain image its size as attributes, so the browser holds its box', async () => {
        await render('<img src="https://example.com/cat.png" alt="Cat" data-width="800" data-height="400">');
        const cat = el.querySelector('img[alt="Cat"]');
        expect(cat?.getAttribute('width')).toBe('800');
        expect(cat?.getAttribute('height')).toBe('400');
    });

    it('does not open the placeholder full size', async () => {
        await render(`<img src="attachment://${NOTE}/jrnl_img0" alt="Kite" data-width="1600" data-height="900">`);
        const opener = el.querySelector('[role="button"]') as HTMLElement;
        await act(async () => {
            opener.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
            opener.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
        });
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });

    it('keeps the grey pulse for an image whose size is not known yet', async () => {
        await render(`![Kite](attachment://${NOTE}/jrnl_img0)`);
        expect(placeholder()).toBeNull();
        expect(el.querySelector('.animate-pulse')).not.toBeNull();
    });
});
