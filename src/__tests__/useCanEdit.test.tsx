// @vitest-environment happy-dom
/** #1176: useCanEdit() is the stub's always-true answer unless the native entitlement says otherwise. */
import { describe, it, expect, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { existsSync } from 'fs';
import { getCanEdit, setCanEdit, useCanEdit } from '@/hooks/useCanEdit';
import { CanEditReporter } from '@/components/license/License';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderCanEdit(): Promise<{ value: () => boolean; unmount: () => Promise<void> }> {
    let value = false;
    function Probe() {
        value = useCanEdit();
        return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    const client = new QueryClient();
    await act(async () => {
        root.render(createElement(QueryClientProvider, { client }, createElement(CanEditReporter), createElement(Probe)));
    });
    // Let the lazy @premium import resolve and its effect run.
    await act(async () => {
        await import('@premium');
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { value: () => value, unmount: () => act(async () => root.unmount()) };
}

afterEach(() => {
    setCanEdit(true);
    delete window.__JOURNAL_NATIVE__;
});

describe('useCanEdit', () => {
    it('is true on the web', async () => {
        const probe = await renderCanEdit();
        expect(probe.value()).toBe(true);
        await probe.unmount();
    });

    it.skipIf(existsSync('native/web/index.ts'))('is true in the native app with the public stub', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'ios' };
        const probe = await renderCanEdit();
        expect(probe.value()).toBe(true);
        await probe.unmount();
    });

    it('re-renders when the entitlement turns read-only and back', async () => {
        const probe = await renderCanEdit();
        await act(async () => setCanEdit(false));
        expect(probe.value()).toBe(false);
        expect(getCanEdit()).toBe(false);
        await act(async () => setCanEdit(true));
        expect(probe.value()).toBe(true);
        await probe.unmount();
    });

    it('stays editable while the native app reads its entitlement', async () => {
        setCanEdit(undefined);
        const probe = await renderCanEdit();
        expect(probe.value()).toBe(true);
        expect(getCanEdit()).toBe(true);
        await probe.unmount();
    });
});
