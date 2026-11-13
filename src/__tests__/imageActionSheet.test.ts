// @vitest-environment happy-dom
/**
 * #937: on a phone the image toolbar is one row, and the actions that do not fit
 * (alignment, View full size, Replace, Download) are in an "Image actions" sheet.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NodeViewProps } from '@tiptap/react';

// The editor's read-only flag (#1211): editable unless a case says otherwise.
const editorContext = vi.hoisted(() => ({ readOnly: false }));
vi.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => editorContext }));
vi.mock('@/components/OdinImage/OdinImage', () => ({ OdinImage: () => null }));
vi.mock('@/hooks/image/useLocalImage', () => ({ useLocalImage: () => null }));

import { ImageNodeView } from '@/components/editor/nodes/ImageNode';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ImageNodeView image actions sheet', () => {
    let root: Root;
    let el: HTMLDivElement;
    afterEach(async () => {
        await act(async () => root.unmount());
        el.remove();
        document.body.innerHTML = '';
        editorContext.readOnly = false;
    });

    async function render(updateAttributes: (attrs: Record<string, unknown>) => void, align: string | null = null) {
        el = document.createElement('div');
        document.body.appendChild(el);
        root = createRoot(el);
        const props = {
            node: { attrs: { src: 'https://example.com/kite.png', alt: 'A kite', width: null, align } },
            updateAttributes,
            selected: true,
            getPos: () => undefined,
        } as unknown as NodeViewProps;
        await act(async () => { root.render(h(ImageNodeView, props)); });
    }

    const openSheet = async () => {
        const more = el.querySelector<HTMLButtonElement>('button[aria-label="Image actions"]');
        await act(async () => more!.click());
        return document.querySelector('[role="menu"][aria-label="Image actions"]');
    };

    it('lists the alignment, view, replace and download actions', async () => {
        await render(() => {});

        const menu = await openSheet();

        const labels = Array.from(menu!.querySelectorAll('[role^="menuitem"]')).map((item) => item.textContent);
        expect(labels).toEqual(['Float left', 'Center', 'Float right', 'View full size', 'Replace image', 'Download image']);
    });

    it('checks the current alignment and clears it when chosen again', async () => {
        const updates: Record<string, unknown>[] = [];
        await render((attrs) => updates.push(attrs), 'center');

        const menu = await openSheet();
        const center = Array.from(menu!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find((item) => item.textContent === 'Center');
        expect(center?.getAttribute('aria-checked')).toBe('true');
        await act(async () => center!.click());

        expect(updates).toEqual([{ align: null }]);
    });

    it('sets an alignment chosen in the sheet', async () => {
        const updates: Record<string, unknown>[] = [];
        await render((attrs) => updates.push(attrs));

        const menu = await openSheet();
        const left = Array.from(menu!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')).find((item) => item.textContent === 'Float left');
        await act(async () => left!.click());

        expect(updates).toEqual([{ align: 'left' }]);
    });

    it("has no toolbar or resize handles in a read-only editor, as a note shared view-only (#897, #1211)", async () => {
        editorContext.readOnly = true;
        await render(() => {});
        expect(el.querySelector('button[aria-label="Image actions"]')).toBeNull();
        expect(el.querySelector('button[aria-label="Alt text"]')).toBeNull();
        expect(el.querySelector('[aria-label^="Resize image"]')).toBeNull();
    });
});
