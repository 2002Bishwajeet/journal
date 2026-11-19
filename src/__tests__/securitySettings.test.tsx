// @vitest-environment happy-dom
/**
 * #1363: Settings -> Security in each state, and the lock screen. The phone and a desktop
 * page without Tauri show only "Show notes outside the app"; the desktop app shows that its
 * notes are encrypted, and the lock where Touch ID or Windows Hello can confirm the owner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement as h, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SecurityStatus } from '@/lib/appLock';

const { invoke, retryDatabase } = vi.hoisted(() => ({
    invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
    retryDatabase: vi.fn(async () => {}),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/lib/db', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/db')>()), retryDatabase }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import SecuritySection from '@/components/settings/sections/SecuritySection';
import { BootErrorScreen } from '@/components/layout/SplashScreen';
import { clearBootError, reportBootError } from '@/lib/bootProgress';
import { DatabaseLockedError, LOCKED_SESSION_KEY } from '@/lib/db/databaseKey';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let status: SecurityStatus;

async function render(element: ReactElement) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => root.render(h(QueryClientProvider, { client }, element)));
    // React Query answers on a later macrotask.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

function desktop(platform: 'macos' | 'windows' | 'linux') {
    window.__JOURNAL_NATIVE__ = { platform, plugins: [] };
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

const text = () => document.body.textContent ?? '';
const control = (id: string) => document.getElementById(id);
const button = (name: string) => [...document.querySelectorAll('button')].find((b) => b.textContent === name);

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    status = { lockAvailable: true, lockOn: false, passphrase: false };
    invoke.mockReset();
    invoke.mockImplementation(async (cmd) => (cmd === 'plugin:journal-db-key|security_status' ? status : null));
    retryDatabase.mockClear();
    vi.spyOn(window.location, 'reload').mockImplementation(() => {});
});

afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
    delete window.__JOURNAL_NATIVE__;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    clearBootError();
    vi.restoreAllMocks();
});

describe('Settings -> Security', () => {
    it('the phone shows only "Show notes outside the app"', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'ios', plugins: [] };
        await render(h(SecuritySection));
        expect(control('security-notes-outside-app')).not.toBeNull();
        expect(text()).not.toContain('encrypted');
        expect(control('security-app-lock')).toBeNull();
        expect(invoke).not.toHaveBeenCalled();
    });

    it('the Mac says its notes are encrypted and offers the lock, off', async () => {
        desktop('macos');
        await render(h(SecuritySection));
        expect(text()).toContain('Notes on this device are encrypted');
        expect(text()).toContain('The key is in the system keychain.');
        expect(text()).toContain('Ask for Touch ID or your password before Journal shows your notes.');
        expect(control('security-app-lock')?.getAttribute('aria-checked')).toBe('false');
        expect(control('security-lock-after')).toBeNull();
        expect(control('security-lock-now')).toBeNull();
    });

    it('with the lock on: Lock after (Never by default) and Lock now', async () => {
        desktop('windows');
        status.lockOn = true;
        await render(h(SecuritySection));
        expect(text()).toContain('Ask for Windows Hello');
        expect(control('security-app-lock')?.getAttribute('aria-checked')).toBe('true');
        expect((control('security-lock-after') as HTMLSelectElement).value).toBe('');
        expect(text()).toContain('Off while the app lock is on, unless you turn it on.');

        await act(async () => control('security-lock-now')!.click());
        await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalled());
        expect(invoke).toHaveBeenCalledWith('plugin:journal-db-key|lock_database', undefined);
        expect(sessionStorage.getItem(LOCKED_SESSION_KEY)).toBe('1');
    });

    it('turning the lock on asks the key command, then shows it on', async () => {
        desktop('macos');
        await render(h(SecuritySection));
        invoke.mockImplementation(async (cmd) => {
            if (cmd === 'plugin:journal-db-key|set_app_lock') status.lockOn = true;
            return cmd === 'plugin:journal-db-key|security_status' ? status : null;
        });
        await act(async () => control('security-app-lock')!.click());
        await vi.waitFor(async () => {
            await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
            expect(control('security-app-lock')?.getAttribute('aria-checked')).toBe('true');
        });
        expect(invoke).toHaveBeenCalledWith('plugin:journal-db-key|set_app_lock', { on: true });
        expect(control('security-lock-now')).not.toBeNull();
    });

    it('Linux: no lock, and a passphrase where there is no keychain', async () => {
        desktop('linux');
        status = { lockAvailable: false, lockOn: false, passphrase: true };
        await render(h(SecuritySection));
        expect(text()).toContain('Notes on this device are encrypted');
        expect(text()).toContain('This computer has no keychain (Secret Service), so your passphrase protects the key.');
        expect(control('security-app-lock')).toBeNull();
    });
});

describe('the lock screen', () => {
    it.each([
        ['cancelled', false],
        ['failed', true],
    ] as const)('shows no note when Touch ID is %s, and Unlock asks again', async (reason, saysFailed) => {
        sessionStorage.setItem(LOCKED_SESSION_KEY, '1');
        reportBootError(new DatabaseLockedError(reason));
        await render(h(BootErrorScreen));
        expect(text()).toContain('Journal is locked');
        expect(text().includes("Couldn't confirm it's you.")).toBe(saysFailed);

        await act(async () => button('Unlock')!.click());
        await vi.waitFor(() => expect(retryDatabase).toHaveBeenCalledOnce());
        expect(sessionStorage.getItem(LOCKED_SESSION_KEY)).toBeNull();
        await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalled());
    });

    it('a passphrase screen for a Linux without a keychain, which says when one was wrong', async () => {
        const error = Object.assign(new Error('Enter the passphrase'), { name: 'PassphraseNeededError', isNew: false, wrong: true });
        reportBootError(error);
        await render(h(BootErrorScreen));
        expect(text()).toContain('Enter your passphrase');
        expect(text()).toContain("That passphrase didn't open your notes.");
        expect(button('Reset local data and sync again')).toBeDefined();
    });
});
