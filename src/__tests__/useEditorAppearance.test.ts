// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import {
    useEditorAppearance,
    type EditorFont,
    type EditorWidth,
} from '@/hooks/useEditorAppearance';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

type Api = ReturnType<typeof useEditorAppearance>;

async function mount(): Promise<{ api: () => Api }> {
    let current!: Api;
    function C() {
        current = useEditorAppearance();
        return null;
    }
    const el = document.createElement('div');
    document.body.appendChild(el);
    await act(async () => { createRoot(el).render(h(C)); });
    return { api: () => current };
}

const html = () => document.documentElement;

beforeEach(() => {
    localStorage.clear();
    html().removeAttribute('data-editor-font');
    html().removeAttribute('data-editor-width');
});

describe('useEditorAppearance', () => {
    it('defaults to sans and default width when nothing is stored', async () => {
        const { api } = await mount();
        expect(api().font).toBe('sans');
        expect(api().width).toBe('default');
        expect(html().getAttribute('data-editor-font')).toBe('sans');
        expect(html().getAttribute('data-editor-width')).toBe('default');
    });

    it('applies and persists a chosen font and width immediately', async () => {
        const { api } = await mount();
        await act(async () => { api().setFont('serif'); });
        await act(async () => { api().setWidth('narrow'); });
        expect(api().font).toBe('serif');
        expect(api().width).toBe('narrow');
        expect(html().getAttribute('data-editor-font')).toBe('serif');
        expect(html().getAttribute('data-editor-width')).toBe('narrow');
        expect(localStorage.getItem('journal-editor-font')).toBe('serif');
        expect(localStorage.getItem('journal-editor-width')).toBe('narrow');
    });

    it('restores stored preferences on mount', async () => {
        localStorage.setItem('journal-editor-font', 'mono');
        localStorage.setItem('journal-editor-width', 'full');
        const { api } = await mount();
        expect(api().font).toBe('mono' satisfies EditorFont);
        expect(api().width).toBe('full' satisfies EditorWidth);
        expect(html().getAttribute('data-editor-font')).toBe('mono');
        expect(html().getAttribute('data-editor-width')).toBe('full');
    });

    it('falls back to the defaults when the stored values are invalid', async () => {
        localStorage.setItem('journal-editor-font', 'comic-sans');
        localStorage.setItem('journal-editor-width', '9000');
        const { api } = await mount();
        expect(api().font).toBe('sans');
        expect(api().width).toBe('default');
        expect(html().getAttribute('data-editor-font')).toBe('sans');
        expect(html().getAttribute('data-editor-width')).toBe('default');
    });
});
