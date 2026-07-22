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
