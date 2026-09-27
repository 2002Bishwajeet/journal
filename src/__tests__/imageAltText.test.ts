// @vitest-environment happy-dom
/**
 * #181: users can give an image a text description, and assistive tech
 * announces it exactly once. The blurred OdinImage placeholder always stays
 * decorative — only the final image should carry the real alt text.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NodeViewProps } from '@tiptap/react';
import type { DotYouClient } from '@homebase-id/js-lib/core';

const { odinImageProps } = vi.hoisted(() => ({ odinImageProps: [] as Record<string, unknown>[] }));
vi.mock('@/components/OdinImage/OdinImage', () => ({
    OdinImage: (props: Record<string, unknown>) => { odinImageProps.push(props); return null; },
}));
// No local copy (#179): the node falls back to OdinImage
vi.mock('@/hooks/image/useLocalImage', () => ({ useLocalImage: () => null }));

import { ImageNodeView } from '@/components/editor/nodes/ImageNode';
import { OdinPreviewImage } from '@/components/OdinImage/OdinPreviewImage';
import { JOURNAL_DRIVE } from '@/lib/homebase/config';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('ImageNodeView alt text — plain image', () => {
    let root: Root;
    let el: HTMLDivElement;
    afterEach(async () => {
        await act(async () => root.unmount());
        el.remove();
    });

    async function render(alt: string | null) {
        el = document.createElement('div');
        root = createRoot(el);
        const props = {
            node: { attrs: { src: 'https://example.com/kite.png', alt, width: null, align: null } },
            updateAttributes: () => {},
            selected: false,
        } as unknown as NodeViewProps;
        await act(async () => { root.render(h(ImageNodeView, props)); });
    }

    it("renders exactly one img carrying the node's alt text", async () => {
        await render('A red kite');

        const matches = Array.from(el.querySelectorAll('img')).filter((img) => img.alt === 'A red kite');
        expect(matches).toHaveLength(1);
    });

    it('falls back to an empty alt when the node has none', async () => {
        await render(null);

        expect(el.querySelector('img')?.getAttribute('alt')).toBe('');
    });

    it('shows an Alt text control, pressed once alt is set', async () => {
        await render('A red kite');

        const button = el.querySelector('button[aria-label="Alt text"]');
        expect(button?.getAttribute('aria-pressed')).toBe('true');
        expect(button?.textContent).toBe('ALT');
    });

    it('leaves the Alt text control unpressed with no alt', async () => {
        await render(null);

        const button = el.querySelector('button[aria-label="Alt text"]');
        expect(button?.getAttribute('aria-pressed')).toBe('false');
    });

    it('opens the Alt text popover and commits the trimmed value on Enter', async () => {
        let saved: Record<string, unknown> | undefined;
        el = document.createElement('div');
        document.body.appendChild(el);
        root = createRoot(el);
        const props = {
            node: { attrs: { src: 'https://example.com/kite.png', alt: null, width: null, align: null } },
            updateAttributes: (attrs: Record<string, unknown>) => { saved = attrs; },
            selected: false,
        } as unknown as NodeViewProps;
        await act(async () => { root.render(h(ImageNodeView, props)); });

        const trigger = el.querySelector('button[aria-label="Alt text"]') as HTMLButtonElement;
        await act(async () => { trigger.click(); });

        const input = document.body.querySelector('input[aria-label="Alt text"]') as HTMLInputElement;
        expect(input).not.toBeNull();
        input.value = '  A red kite  ';

        await act(async () => {
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        });

        expect(saved).toEqual({ alt: 'A red kite' });
    });
});

describe('ImageNodeView alt text — attachment (remote) image', () => {
    afterEach(() => { odinImageProps.length = 0; });

    it('passes the alt text through to OdinImage', async () => {
        const el = document.createElement('div');
        const root = createRoot(el);
        const props = {
            node: { attrs: { src: 'attachment://file-1/jrnl_img0', alt: 'A red kite', width: null, align: null } },
            updateAttributes: () => {},
            selected: false,
        } as unknown as NodeViewProps;

        await act(async () => { root.render(h(ImageNodeView, props)); });
        expect(odinImageProps.at(-1)?.alt).toBe('A red kite');

        await act(async () => { root.unmount(); });
    });
});

describe('OdinPreviewImage — blurred placeholder stays decorative', () => {
    async function renderPlaceholder(alt: string) {
        const client = new QueryClient();
        const dotYouClient = { getHostIdentity: () => 'me.dotyou.cloud' } as unknown as DotYouClient;
        const el = document.createElement('div');
        const root = createRoot(el);
        await act(async () => {
            root.render(
                h(
                    QueryClientProvider,
                    { client },
                    h(OdinPreviewImage, {
                        dotYouClient,
                        targetDrive: JOURNAL_DRIVE,
                        fileId: undefined,
                        fileKey: undefined,
                        alt,
                    }),
                ),
            );
        });
        return el.querySelector('img');
    }

    it('overrides a passed alt so only the final image is announced', async () => {
        const img = await renderPlaceholder('x');

        expect(img?.getAttribute('alt')).toBe('');
        expect(img?.getAttribute('aria-hidden')).toBe('true');
    });
});
