// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

function Probe({ title }: { title: string | null | undefined }) {
    useDocumentTitle(title);
    return null;
}

async function mount(title: string | null | undefined) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(h(Probe, { title })); });
    return {
        rerender: (next: string | null | undefined) =>
            act(async () => { root.render(h(Probe, { title: next })); }),
        unmount: async () => { await act(async () => root.unmount()); el.remove(); },
    };
}

describe('useDocumentTitle', () => {
    it('sets document.title to "<title> · Journal" when given a title', async () => {
        const s = await mount('Groceries');

        expect(document.title).toBe('Groceries · Journal');

        await s.unmount();
    });

    it.each([null, undefined])('falls back to "Journal" when the title is %s', async (title) => {
        const s = await mount(title);

        expect(document.title).toBe('Journal');

        await s.unmount();
    });

    it('updates document.title when the title changes', async () => {
        const s = await mount('Groceries');
        await s.rerender('Shopping list');

        expect(document.title).toBe('Shopping list · Journal');

        await s.unmount();
    });

    it('resets to "Journal" on unmount so pages without a title do not inherit a stale one', async () => {
        const s = await mount('Groceries');
        await s.unmount();

        expect(document.title).toBe('Journal');
    });
});
