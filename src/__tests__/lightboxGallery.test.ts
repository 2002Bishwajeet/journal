// @vitest-environment happy-dom
/**
 * #1369: the lightbox steps through a gallery's images. Stepping stops at the ends, a
 * sideways swipe steps and a vertical one doesn't, and the editor's gallery is read from
 * the document, leaving out images that are still uploading.
 */
import { describe, it, expect } from 'vitest';
import type { Editor } from '@tiptap/core';
import { createTrackedEditor } from './trackedEditor';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { galleryLightbox } from '@/components/editor/nodes/galleryLightbox';
import { stepIndex, swipeStep } from '@/lib/images/lightboxGallery';

describe('stepIndex', () => {
    it('moves one image and stops at both ends', () => {
        expect(stepIndex(1, 3, 1)).toBe(2);
        expect(stepIndex(1, 3, -1)).toBe(0);
        expect(stepIndex(2, 3, 1)).toBe(2);
        expect(stepIndex(0, 3, -1)).toBe(0);
    });

    it('stays on the only image of a single one', () => {
        expect(stepIndex(0, 1, 1)).toBe(0);
        expect(stepIndex(0, 1, -1)).toBe(0);
    });
});

describe('swipeStep', () => {
    it('steps to the next image on a swipe left and the previous on a swipe right', () => {
        expect(swipeStep(-80, 5)).toBe(1);
        expect(swipeStep(80, -5)).toBe(-1);
    });

    it('ignores a short drag and a mostly vertical one', () => {
        expect(swipeStep(30, 0)).toBe(0);
        expect(swipeStep(60, 120)).toBe(0);
    });
});

describe('galleryLightbox', () => {
    const img = (alt: string, src = `https://e.com/${alt}.png`) => `<img src="${src}" alt="${alt}">`;
    let editor: Editor;
    const mk = (html: string) => {
        editor = createTrackedEditor({ element: document.createElement('div'), extensions: createBaseExtensions(), content: html });
    };
    const posOf = (alt: string) => {
        let found = -1;
        editor.state.doc.descendants((node, pos) => {
            if (node.type.name === 'image' && node.attrs.alt === alt) found = pos;
        });
        return found;
    };

    it('lists the gallery in order with the opened image marked', () => {
        mk(`<div data-gallery="grid">${img('A')}${img('B')}${img('C')}</div>`);
        const gallery = galleryLightbox(editor.state, posOf('B'));
        expect(gallery?.items.map((i) => i.alt)).toEqual(['A', 'B', 'C']);
        expect(gallery?.index).toBe(1);
    });

    it('is undefined for an image outside a gallery', () => {
        mk(`<p>${img('A')}</p><div data-gallery="grid">${img('B')}${img('C')}</div>`);
        expect(galleryLightbox(editor.state, posOf('A'))).toBeUndefined();
    });

    it('leaves out images still uploading, and is undefined when one is left', () => {
        mk(`<div data-gallery="row">${img('A')}${img('B', 'blob:pending')}${img('C')}</div>`);
        const gallery = galleryLightbox(editor.state, posOf('C'));
        expect(gallery?.items.map((i) => i.alt)).toEqual(['A', 'C']);
        expect(gallery?.index).toBe(1);

        mk(`<div data-gallery="row">${img('A')}${img('B', 'blob:pending')}</div>`);
        expect(galleryLightbox(editor.state, posOf('A'))).toBeUndefined();
    });
});
