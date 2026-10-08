// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { sync, logout, pending } = vi.hoisted(() => ({
    sync: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    pending: { total: 0 },
}));

vi.mock('@/hooks/auth/useAuth', () => ({
    useAuth: () => ({ getIdentity: () => 'frodo.dotyou.cloud', logout }),
}));

vi.mock('@/hooks/useSyncService', () => ({
    useSyncService: () => ({
        syncStatus: 'idle',
        lastSyncedAt: new Date(),
        pendingCount: { notes: pending.total, folders: 0, images: 0, total: pending.total },
        sync,
    }),
}));

import AccountSection from '@/components/settings/sections/AccountSection';

function buttonByText(text: string) {
    return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
}

describe('Account settings', () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(async () => {
        sync.mockClear();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => { root.unmount(); });
        host.remove();
    });

    async function render(pendingTotal: number) {
        pending.total = pendingTotal;
        await act(async () => { root.render(createElement(AccountSection)); });
    }

    async function openSignOutDialog() {
        await act(async () => { buttonByText('Sign out')?.click(); });
        return document.querySelector('[role="dialog"]')?.textContent ?? '';
    }

    it('shows the signed-in identity', async () => {
        await render(0);
        expect(host.textContent).toContain('frodo.dotyou.cloud');
    });

    it('warns that unsynced changes will be lost when changes are pending', async () => {
        await render(3);
        expect(host.textContent).toContain('3 changes waiting to sync · last synced');
        expect(host.textContent).not.toContain('Up to date');
        const dialog = await openSignOutDialog();
        expect(dialog).toContain('Sign out?');
        expect(dialog).toContain("3 changes on this device haven't synced");
    });

    it('says "Up to date" only when nothing is pending', async () => {
        await render(0);
        expect(host.textContent).toContain('Up to date · last synced');
        expect(host.textContent).not.toContain('waiting');
    });

    it('uses the singular for one pending change', async () => {
        await render(1);
        expect(host.textContent).toContain('1 change waiting to sync');
    });

    it('reassures the notes are safe when nothing is pending', async () => {
        await render(0);
        const dialog = await openSignOutDialog();
        expect(dialog).toContain('Sign out?');
        expect(dialog).not.toContain("haven't synced");
        expect(dialog).toContain('Your notes stay safe in your Homebase');
    });

    it('Sync now triggers a sync', async () => {
        await render(0);
        await act(async () => { buttonByText('Sync now')?.click(); });
        expect(sync).toHaveBeenCalledTimes(1);
    });
});
