// @vitest-environment happy-dom
/**
 * #179: an uploaded image renders from its locally kept bytes when this device
 * has them (works offline); otherwise from the server via OdinImage. A server
 * image that fails while offline says so instead of "Something went wrong".
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { NodeViewProps } from '@tiptap/react';

const m = vi.hoisted(() => ({
    local: null as string | null | undefined,
    previews: undefined as Record<string, { thumb?: unknown; size?: { width: number; height: number }; sizes?: unknown[] }> | undefined,
}));
// The editor's read-only flag (#1211): these notes are editable.
vi.mock('@/components/editor/EditorContext', () => ({ useEditorContext: () => ({ readOnly: false }) }));
vi.mock('@/hooks/image/useNoteImagePreviews', () => ({ useNoteImagePreviews: () => m.previews }));
vi.mock('@/hooks/image/useLocalImage', () => ({ useLocalImage: () => m.local }));
vi.mock('@/hooks/usePendingImage', () => ({ usePendingImage: () => ({ url: undefined, state: 'remote' as const }) }));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ sync: async () => {} }) }));
vi.mock('@/lib/db', () => ({ retryPendingImageUploadNow: async () => {}, deletePendingImageUpload: async () => {} }));
vi.mock('@/components/OdinImage/OdinImage', () => ({
    OdinImage: ({ fileId, fileKey, initialSize, previewThumbnail }: { fileId: string; fileKey: string; initialSize?: { pixelWidth: number; pixelHeight: number }; previewThumbnail?: unknown }) =>
        h('span', {
            'data-testid': 'odin',
            'data-file': `${fileId}/${fileKey}`,
            'data-initial': initialSize ? `${initialSize.pixelWidth}x${initialSize.pixelHeight}` : '',
            'data-tiny': previewThumbnail ? 'yes' : '',
        }),
}));

import { ImageNodeView } from '@/components/editor/nodes/ImageNode';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ImageNodeView attachment image', () => {
    let root: Root;
    let el: HTMLDivElement;

    beforeEach(() => {
        m.previews = undefined;
        written.length = 0;
        el = document.createElement('div');
        root = createRoot(el);
    });
    afterEach(async () => { await act(async () => root.unmount()); });

    const written: { attrs: Record<string, unknown>; meta: Record<string, unknown> }[] = [];
    // Just enough editor for the node view's one quiet size write
    const editor = {
        isDestroyed: false,
        state: {
            doc: {
                content: { size: 10 },
                resolve: () => ({ parent: { type: { name: 'paragraph' } } }),
                nodeAt: () => ({ type: { name: 'image' }, attrs: { src: 'attachment://file-1/jrnl_img0' } }),
            },
            tr: {
                meta: {} as Record<string, unknown>,
                attrs: {} as Record<string, unknown>,
                setNodeMarkup(_pos: number, _type: unknown, attrs: Record<string, unknown>) { this.attrs = attrs; return this; },
                setMeta(key: string, value: unknown) { this.meta[key] = value; return this; },
            },
        },
        view: { dispatch: (tr: { attrs: Record<string, unknown>; meta: Record<string, unknown> }) => { written.push({ attrs: tr.attrs, meta: tr.meta }); } },
    };

    async function render(extra: Record<string, unknown> = {}, pos?: number) {
        const props = {
            node: { attrs: { src: 'attachment://file-1/jrnl_img0', alt: 'kite', width: null, align: null, ...extra } },
            updateAttributes: () => {},
            selected: false,
            editor,
            getPos: () => pos,
        } as unknown as NodeViewProps;
        await act(async () => { root.render(h(ImageNodeView, props)); });
    }

    it('renders the locally kept bytes when this device has them', async () => {
        m.local = 'blob:local';
        await render();
        const img = el.querySelector('img');
        expect(img?.getAttribute('src')).toBe('blob:local');
        expect(img?.getAttribute('alt')).toBe('kite');
        expect(el.querySelector('[data-testid="odin"]')).toBeNull();
    });

    it('fetches nothing from the server while the local lookup is pending', async () => {
        m.local = undefined;
        await render();
        expect(el.querySelector('[data-testid="odin"]')).toBeNull();
        expect(el.querySelector('img')).toBeNull();
    });

    it('falls back to the server image otherwise', async () => {
        m.local = null;
        await render();
        expect(el.querySelector('[data-testid="odin"]')?.getAttribute('data-file')).toBe('file-1/jrnl_img0');
    });

    describe('reserving the box (#1387)', () => {
        const tiny = { contentType: 'image/jpeg', content: 'AAAA', pixelWidth: 20, pixelHeight: 11 };

        it('holds the stored size and the tiny thumbnail while it looks for a local copy', async () => {
            m.local = undefined;
            m.previews = { jrnl_img0: { thumb: tiny } };
            await render({ naturalWidth: 1600, naturalHeight: 900 });
            const holder = el.querySelector('[data-testid="image-placeholder"]');
            expect(holder?.getAttribute('width')).toBe('1600');
            expect(holder?.getAttribute('height')).toBe('900');
            expect(holder?.getAttribute('src')).toBe('data:image/jpeg;base64,AAAA');
            expect(el.querySelector('[data-testid="odin"]')).toBeNull();
        });

        it('gives the kept local copy the size too, so it holds its box before it decodes', async () => {
            m.local = 'blob:local';
            await render({ naturalWidth: 1600, naturalHeight: 900 });
            const img = el.querySelector('img[src="blob:local"]');
            expect(img?.getAttribute('width')).toBe('1600');
            expect(img?.getAttribute('height')).toBe('900');
            expect(el.querySelector('[data-testid="image-placeholder"]')).toBeNull();
        });

        it('passes the server image its size and tiny thumbnail from the first render', async () => {
            m.local = null;
            m.previews = { jrnl_img0: { thumb: tiny, size: { width: 1600, height: 900 } } };
            await render({ naturalWidth: 1600, naturalHeight: 900 });
            const odin = el.querySelector('[data-testid="odin"]');
            expect(odin?.getAttribute('data-initial')).toBe('1600x900');
            expect(odin?.getAttribute('data-tiny')).toBe('yes');
        });

        it('takes the size from the note file when the node has none (a note from before)', async () => {
            m.local = undefined;
            m.previews = { jrnl_img0: { thumb: tiny, size: { width: 1280, height: 720 } } };
            await render({}, 0);
            expect(el.querySelector('[data-testid="image-placeholder"]')?.getAttribute('width')).toBe('1280');
        });

        it('writes that size onto the node once, and not as an undo step', async () => {
            m.local = null;
            m.previews = { jrnl_img0: { size: { width: 1280, height: 720 } } };
            await render({}, 0);
            expect(written).toHaveLength(1);
            expect(written[0].attrs).toMatchObject({ naturalWidth: 1280, naturalHeight: 720 });
            expect(written[0].meta).toEqual({ addToHistory: false });
        });

        it('writes nothing for a node that has its size', async () => {
            m.local = null;
            m.previews = { jrnl_img0: { size: { width: 1280, height: 720 } } };
            await render({ naturalWidth: 1600, naturalHeight: 900 }, 0);
            expect(written).toHaveLength(0);
        });

        it('does not hand the server image the tiny thumbnail without a size: its own is rounded to a few pixels', async () => {
            m.local = null;
            m.previews = { jrnl_img0: { thumb: tiny } };
            await render();
            const odin = el.querySelector('[data-testid="odin"]');
            expect(odin?.getAttribute('data-initial')).toBe('');
            expect(odin?.getAttribute('data-tiny')).toBe('');
        });

        it('still renders nothing while it looks, when no size is known yet', async () => {
            m.local = undefined;
            await render();
            expect(el.querySelector('img')).toBeNull();
        });
    });
});
