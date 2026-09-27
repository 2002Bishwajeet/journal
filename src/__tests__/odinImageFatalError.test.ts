// @vitest-environment happy-dom
/** #179: a server image that fails while offline says it needs a connection. */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { FatalError } from '@/components/OdinImage/OdinImage';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => { vi.restoreAllMocks(); });

async function text(online: boolean): Promise<string> {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    const el = document.createElement('div');
    const root = createRoot(el);
    await act(async () => { root.render(h(FatalError)); });
    const t = el.textContent ?? '';
    await act(async () => root.unmount());
    return t;
}

describe('OdinImage FatalError', () => {
    it('says the image is available when online, when offline', async () => {
        expect(await text(false)).toContain('Image available when online');
    });

    it('keeps the generic error when online', async () => {
        expect(await text(true)).toContain('Something went wrong');
    });
});
