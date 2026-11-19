import type { Page } from '@playwright/test';

/**
 * The native app reads its Homebase sign-in from the OS keychain before it renders (#1429,
 * src-tauri/src/db_key.rs `auth_secrets`), and a keychain it can't read is a boot error. A
 * spec that fakes Tauri's IPC calls this after its own init script: the keychain commands get
 * a device's answers, the entry kept in localStorage so a reload stays signed in, and every
 * other command goes to the spec's fake.
 */
export async function fakeKeychain(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const ipc = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
        if (!ipc) return;
        const ENTRY = 'e2e-keychain';
        const read = (): Record<string, string> => JSON.parse(localStorage.getItem(ENTRY) ?? '{}');
        const next = ipc.invoke;
        ipc.invoke = async (cmd, args = {}) => {
            if (cmd === 'plugin:journal-db-key|auth_secrets') return { secrets: read() };
            if (cmd === 'plugin:journal-db-key|set_auth_secret') {
                const { key, value } = args as { key: string; value: string | null };
                const secrets = read();
                if (value === null) delete secrets[key];
                else secrets[key] = value;
                localStorage.setItem(ENTRY, JSON.stringify(secrets));
                return null;
            }
            if (cmd === 'plugin:journal-db-key|clear_auth_secrets') {
                localStorage.removeItem(ENTRY);
                return null;
            }
            return next(cmd, args);
        };
    });
}
