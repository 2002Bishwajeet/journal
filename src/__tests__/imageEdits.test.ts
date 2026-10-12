/**
 * #584: non-destructive crop, rotate and flip. The geometry of the edited box,
 * the crop drawn over the turned image in the edit dialog, and the markdown /
 * share page form.
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { editorSchema, toMarkdown, createDoc } from '@/lib/agent/editEngine';
import { shareRehypePlugins, shareRemarkPlugins } from '@/lib/share/markdownPipeline';
import {
    NO_EDITS,
    centeredCrop,
    dragCorner,
    editAttrs,
    editLayers,
    editedSize,
    fromDisplayCrop,
    hasEdits,
    moveCrop,
    normalizeCrop,
    parseEditData,
    readEdits,
    rotateEdits,
    toDisplayCrop,
    type ImageEdits,
    type ImageRotation,
} from '@/lib/images/imageEdits';

const NATURAL = { width: 800, height: 400 };
const BAND = { x: 0.25, y: 0.1, w: 0.5, h: 0.8 }; // 400 x 320 px of the original
const edits = (patch: Partial<ImageEdits>): ImageEdits => ({ ...NO_EDITS, ...patch });

describe('edited box geometry', () => {
    const cases: [ImageRotation, number, number][] = [
        [0, 400, 320],
        [90, 320, 400],
        [180, 400, 320],
        [270, 320, 400],
    ];

    it.each(cases)('crops then turns the box: rotate %i gives %ix%i', (rotate, width, height) => {
        expect(editedSize(NATURAL, edits({ crop: BAND, rotate }))).toEqual({ width, height });
        expect(editLayers(NATURAL, edits({ crop: BAND, rotate })).frame.aspectRatio).toBe(`${width} / ${height}`);
    });

    it('turns the whole image when there is no crop', () => {
        expect(editedSize(NATURAL, NO_EDITS)).toEqual(NATURAL);
        expect(editedSize(NATURAL, edits({ rotate: 90 }))).toEqual({ width: 400, height: 800 });
    });

    it('offsets and scales the original so the crop fills the stage', () => {
        expect(editLayers(NATURAL, edits({ crop: BAND })).image).toMatchObject({
            left: '-50%',
            top: '-12.5%',
            width: '200%',
            height: '125%',
        });
        expect(editLayers(NATURAL, NO_EDITS).image).toMatchObject({ left: '0%', top: '0%', width: '100%', height: '100%' });
    });

    it.each(cases)('sizes the stage to the unturned crop and turns it: rotate %i', (rotate) => {
        const { stage } = editLayers(NATURAL, edits({ crop: BAND, rotate }));
        const quarter = rotate % 180 !== 0;
        // 400x320 crop: a quarter turn makes the frame 320x400, so the stage is 125% wide and 80% tall
        expect(stage.width).toBe(quarter ? '125%' : '100%');
        expect(stage.height).toBe(quarter ? '80%' : '100%');
        expect(stage.transform).toBe(`translate(-50%, -50%) scale(1, 1) rotate(${rotate}deg)`);
    });

    it('mirrors on screen, after the rotation', () => {
        expect(editLayers(NATURAL, edits({ rotate: 90, flipH: true })).stage.transform).toBe('translate(-50%, -50%) scale(-1, 1) rotate(90deg)');
        expect(editLayers(NATURAL, edits({ flipV: true })).stage.transform).toBe('translate(-50%, -50%) scale(1, -1) rotate(0deg)');
    });
});

describe('the crop as drawn over the turned image', () => {
    const rotations: ImageRotation[] = [0, 90, 180, 270];

    it('maps a crop of the top left corner to where it shows', () => {
        const corner = { x: 0, y: 0, w: 0.5, h: 0.25 };
        expect(toDisplayCrop(edits({ crop: corner }))).toEqual(corner);
        expect(toDisplayCrop(edits({ crop: corner, rotate: 90 }))).toEqual({ x: 0.75, y: 0, w: 0.25, h: 0.5 });
        expect(toDisplayCrop(edits({ crop: corner, rotate: 180 }))).toEqual({ x: 0.5, y: 0.75, w: 0.5, h: 0.25 });
        expect(toDisplayCrop(edits({ crop: corner, rotate: 270 }))).toEqual({ x: 0, y: 0.5, w: 0.25, h: 0.5 });
        expect(toDisplayCrop(edits({ crop: corner, flipH: true }))).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.25 });
        expect(toDisplayCrop(edits({ crop: corner, flipV: true }))).toEqual({ x: 0, y: 0.75, w: 0.5, h: 0.25 });
    });

    it.each(rotations)('maps back to the same crop of the original: rotate %i, every flip', (rotate) => {
        for (const flipH of [false, true]) {
            for (const flipV of [false, true]) {
                const e = edits({ crop: BAND, rotate, flipH, flipV });
                expect(fromDisplayCrop(toDisplayCrop(e), e)).toEqual(BAND);
            }
        }
    });

    it('is the whole image with no crop', () => {
        expect(toDisplayCrop(edits({ rotate: 270, flipH: true }))).toEqual({ x: 0, y: 0, w: 1, h: 1 });
        expect(fromDisplayCrop({ x: 0, y: 0, w: 1, h: 1 }, edits({ rotate: 90 }))).toBeNull();
    });
});

describe('dialog controls', () => {
    it('rotates right as seen on screen, also when mirrored', () => {
        expect(rotateEdits(NO_EDITS, 1).rotate).toBe(90);
        expect(rotateEdits(NO_EDITS, -1).rotate).toBe(270);
        expect(rotateEdits(edits({ rotate: 270 }), 1).rotate).toBe(0);
        // One flip reverses the stored direction; two flips are a half turn, so not
        expect(rotateEdits(edits({ flipH: true }), 1).rotate).toBe(270);
        expect(rotateEdits(edits({ flipH: true, flipV: true }), 1).rotate).toBe(90);
    });

    it('fits a ratio preset as the largest centred rect', () => {
        // 16:9 over a square image: a band across the middle
        expect(centeredCrop(16 / 9, 1)).toEqual({ x: 0, y: 0.21875, w: 1, h: 0.5625 });
        // 1:1 over a 2:1 image: the middle half
        expect(centeredCrop(1, 2)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
        expect(normalizeCrop(centeredCrop(2, 2))).toBeNull();
    });

    it('drags a corner with the opposite one fixed, keeping a ratio and the image bounds', () => {
        const start = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
        expect(dragCorner(start, 'se', 0.9, 0.6, null, 1)).toEqual({ x: 0.25, y: 0.25, w: expect.closeTo(0.65), h: expect.closeTo(0.35) });
        expect(dragCorner(start, 'nw', 0.5, 0.5, null, 1)).toEqual({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 });
        // 1:1 on a square image: the height follows the width, capped by the bottom edge
        expect(dragCorner(start, 'se', 1.2, 0.3, 1, 1)).toEqual({ x: 0.25, y: 0.25, w: 0.75, h: 0.75 });
        expect(dragCorner(start, 'nw', 0.75, 0.75, null, 1).w).toBeGreaterThan(0);
    });

    it('moves the crop inside the image', () => {
        expect(moveCrop({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, 0.5, -1)).toEqual({ x: 0.6, y: 0, w: 0.4, h: 0.4 });
    });
});

describe('edit attrs', () => {
    it('reads absent or invalid attrs as unedited, and writes unedited parts as null', () => {
        expect(readEdits({})).toEqual(NO_EDITS);
        expect(hasEdits(readEdits({ crop: { x: 'a' }, rotate: 45, flipH: 'yes' }))).toBe(false);
        expect(editAttrs(NO_EDITS)).toEqual({ crop: null, rotate: null, flipH: null, flipV: null });
        expect(editAttrs(edits({ rotate: 90, flipV: true }))).toEqual({ crop: null, rotate: 90, flipH: null, flipV: true });
    });

    it('parses the data attributes, ignoring bad values', () => {
        const attrs: Record<string, string> = { 'data-crop': '0,0.2,1,0.5625', 'data-rotate': '270', 'data-flip': 'hv' };
        expect(parseEditData((n) => attrs[n])).toEqual({ crop: { x: 0, y: 0.2, w: 1, h: 0.5625 }, rotate: 270, flipH: true, flipV: true });
        const bad: Record<string, string> = { 'data-crop': '1,2', 'data-rotate': '33' };
        expect(parseEditData((n) => bad[n])).toEqual(NO_EDITS);
    });
});

const imageAttrs = (md: string) => {
    const doc = yXmlFragmentToProseMirrorRootNode(createDoc(md).getXmlFragment('prosemirror'), editorSchema);
    let attrs: Record<string, unknown> | undefined;
    doc.descendants((n) => {
        if (n.type.name === 'image') attrs = n.attrs;
    });
    return attrs;
};

describe('edits in markdown and on the share page', () => {
    const md = '<img src="attachment://f/jrnl_img0" alt="Crop" width="320" data-crop="0,0.2188,1,0.5625" data-rotate="90" data-flip="h">';

    it('round-trips editor -> markdown -> editor with every edit attr', () => {
        expect(imageAttrs(md)).toMatchObject({ width: 320, crop: { x: 0, y: 0.2188, w: 1, h: 0.5625 }, rotate: 90, flipH: true, flipV: null });
        expect(toMarkdown(createDoc(md))).toBe(md);
        expect(imageAttrs(toMarkdown(createDoc(md)))).toEqual(imageAttrs(md));
    });

    it('writes an <img> for an image with only an edit', () => {
        const turned = '<img src="https://e.com/a.png" alt="a" data-rotate="180">';
        expect(toMarkdown(createDoc(turned))).toBe(turned);
        expect(imageAttrs(turned)).toMatchObject({ crop: null, rotate: 180, flipH: null, flipV: null });
    });

    it('keeps the edit attributes through the share sanitizer', () => {
        const html = renderToStaticMarkup(
            createElement(Markdown, { remarkPlugins: shareRemarkPlugins, rehypePlugins: shareRehypePlugins }, md.replace('attachment://f/jrnl_img0', 'https://e.com/a.png')),
        );
        expect(html).toContain('data-crop="0,0.2188,1,0.5625"');
        expect(html).toContain('data-rotate="90"');
        expect(html).toContain('data-flip="h"');
    });
});
