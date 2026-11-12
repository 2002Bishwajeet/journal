// @vitest-environment happy-dom
/** #1176 audit L1: a failed `@premium` load leaves the app running and editable. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@premium', () => {
    throw new Error('chunk failed to load');
});

import { CanEditReporter } from '@/components/license/License';
import { useCanEdit, useCanEditAnswer } from '@/hooks/useCanEdit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
    delete window.__JOURNAL_NATIVE__;
});

describe('CanEditReporter', () => {
    it('renders nothing and keeps editing on when @premium fails to load', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'macos' };
        let canEdit = false;
        let answer: boolean | undefined;
        function Probe() {
            canEdit = useCanEdit();
            answer = useCanEditAnswer();
            return h('p', null, 'app');
        }
        const host = document.createElement('div');
        const root = createRoot(host);
        await act(async () => root.render(h('div', null, h(CanEditReporter), h(Probe))));
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
        expect(host.textContent).toBe('app');
        expect(canEdit).toBe(true);
        // An answer, not "unknown": /today and Save a copy wait on it.
        expect(answer).toBe(true);
        await act(async () => root.unmount());
    });
});
