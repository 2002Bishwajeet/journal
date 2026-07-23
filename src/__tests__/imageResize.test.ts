// @vitest-environment happy-dom
/**
 * Images used to render at their natural size with no way to resize them. The
 * width now lives as a node attribute so it survives the doc round-trip (and
 * therefore the Yjs sync). Alignment intentionally has no attribute: images are
 * inline nodes, so the existing paragraph TextAlign positions them.
 */
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { resizeWidth, MIN_IMAGE_WIDTH, ALIGN_STYLE } from '@/components/editor/nodes/imageLayout';

function mkEditor(content: string) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return new Editor({ element: el, extensions: createBaseExtensions(), content });
}

const IMG = 'https://example.com/cat.png';

// The first inline node of the first block — the image.
function imageAttrs(e: Editor): Record<string, unknown> {
    const json = e.getJSON() as { content?: { content?: { attrs?: Record<string, unknown> }[] }[] };
    return json.content?.[0]?.content?.[0]?.attrs ?? {};
}

describe('resizeWidth — handle drag math', () => {
    // start: 300px wide box, pointer grabbed at x=500, column is 700px wide.
    const drag = (side: 'left' | 'right', clientX: number) =>
        resizeWidth(side, 300, 500, clientX, 700);

    it('grows the box when the right handle moves right', () => {
        expect(drag('right', 560)).toBe(360);
    });

    it('mirrors the delta for the left handle, so it also grows outward', () => {
        expect(drag('left', 440)).toBe(360);
        expect(drag('left', 560)).toBe(240);
    });

    it('never shrinks below the minimum', () => {
        expect(drag('right', 0)).toBe(MIN_IMAGE_WIDTH);
    });

    it('never grows past the column width', () => {
        expect(drag('right', 9999)).toBe(700);
    });
});

describe('image width attribute', () => {
    it('parses a width from the style and renders it back', () => {
        const e = mkEditor(`<p><img src="${IMG}" style="width: 320px"></p>`);

        expect(imageAttrs(e).width).toBe(320);
        expect(e.getHTML()).toContain('width: 320px');
    });

    it('parses the legacy width attribute', () => {
        const e = mkEditor(`<p><img src="${IMG}" width="240"></p>`);
        expect(imageAttrs(e).width).toBe(240);
    });

    it('leaves width unset when the image has none', () => {
        const e = mkEditor(`<p><img src="${IMG}"></p>`);

        expect(imageAttrs(e).width).toBeNull();
        expect(e.getHTML()).not.toContain('width');
    });

    it('keeps paragraph alignment alongside the image (how images are positioned)', () => {
        const e = mkEditor(`<p style="text-align: right"><img src="${IMG}" style="width: 100px"></p>`);

        expect(e.getHTML()).toContain('text-align: right');
        expect(e.getHTML()).toContain('width: 100px');
    });
});

describe('image float alignment', () => {
    it('round-trips an alignment through data-align', () => {
        const e = mkEditor(`<p><img src="${IMG}" data-align="right"></p>`);

        expect(imageAttrs(e).align).toBe('right');
        expect(e.getHTML()).toContain('data-align="right"');
        expect(e.getHTML()).toContain('float: right');
    });

    it('leaves align unset when the image has none', () => {
        const e = mkEditor(`<p><img src="${IMG}"></p>`);

        expect(imageAttrs(e).align).toBeNull();
        expect(e.getHTML()).not.toContain('float');
    });

    // Both attributes render into the one `style` string, so a `width` in the
    // align map would silently override the dragged size (or vice versa,
    // depending on attribute order). Neither may declare the other's property.
    it('keeps the dragged width when the image is also aligned', () => {
        const e = mkEditor(`<p><img src="${IMG}" data-align="center" style="width: 250px"></p>`);

        const html = e.getHTML();
        expect(html).toContain('width: 250px');
        expect(html).toMatch(/margin: 0(px)? auto/); // the DOM normalises 0 -> 0px
        expect(html.match(/width:/g)).toHaveLength(1);
    });

    it('declares only single-word CSS properties, so the style string stays valid', () => {
        for (const css of Object.values(ALIGN_STYLE)) {
            for (const key of Object.keys(css)) {
                expect(key).toMatch(/^[a-z]+$/);
            }
        }
    });
});
