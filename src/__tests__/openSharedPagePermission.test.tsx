// @vitest-environment happy-dom
/**
 * #1494: a share link opened without peer read offers the permission grant (the existing
 * "Journal needs" prompt) instead of "no access". "Not now" leaves for the app, even after
 * an earlier dismissal; nothing to grant falls back to "no access".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
    open: { invalid: false, noAccess: false, needsPermission: true },
    permissions: null as null | Record<string, unknown>,
    dismiss: vi.fn(),
}));
vi.mock('@/hooks/useOpenSharedNote', () => ({ useOpenSharedNote: () => mocks.open }));
vi.mock('@/hooks/auth/useJournalPermissions', () => ({ useJournalPermissions: () => mocks.permissions }));
vi.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }));

import OpenSharedPage from '@/pages/OpenSharedPage';

const GRANT_URL = 'https://viewer.example.com/owner/appupdate?p=305';
let root: Root;

async function render() {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(h(MemoryRouter, { initialEntries: ['/open-shared?identity=owner.example.com&file=f'] },
        h(Routes, null,
            h(Route, { path: '/open-shared', element: h(OpenSharedPage) }),
            h(Route, { path: '/', element: h('p', null, 'Journal home') }),
        ))));
}

beforeEach(() => {
    mocks.open = { invalid: false, noAccess: false, needsPermission: true };
    mocks.permissions = {
        url: GRANT_URL,
        items: [{ id: 'p305', label: 'Receive notes from people', reason: 'Journal gets the notes and changes that people share with you.' }],
        // Dismissed in the app before: the link still asks
        isDismissed: true,
        dismiss: mocks.dismiss,
        onGrant: vi.fn(),
    };
    mocks.dismiss.mockReset();
});
afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
});

describe('OpenSharedPage without peer read', () => {
    it('offers the permission grant instead of "no access"', async () => {
        await render();

        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog?.textContent).toContain('Journal needs 1 permission');
        expect(dialog?.textContent).toContain('Receive notes from people');
        expect(dialog?.querySelector('a')?.getAttribute('href')).toBe(GRANT_URL);
        expect(document.body.textContent).not.toContain("You don't have access");
    });

    it('"Not now" goes to the app without saving a dismissal', async () => {
        await render();
        const notNow = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Not now')!;
        await act(async () => notNow.click());

        expect(document.body.textContent).toContain('Journal home');
        expect(mocks.dismiss).not.toHaveBeenCalled();
    });

    it('says "no access" when there is nothing to grant', async () => {
        mocks.permissions = null;
        await render();

        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(document.body.textContent).toContain("You don't have access to this note");
    });
});
