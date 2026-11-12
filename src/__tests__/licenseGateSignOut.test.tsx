// @vitest-environment happy-dom
/** #1176 audit H1: the paywall's Sign out asks first, as sign-out wipes unsynced changes. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/lib/billing', () => ({ licenseEnabled: () => true }));
vi.mock('@premium', () => ({
    LicenseGate: ({ onSignOut }: { onSignOut: () => void }) => h('button', { onClick: onSignOut }, 'Paywall sign out'),
}));

import { LicenseGate } from '@/components/license/License';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

async function clickPaywallSignOut(pendingTotal: number) {
    const onSignOut = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(h(LicenseGate, { onSignOut, pendingTotal })));
    await act(async () => {
        await import('@premium');
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Paywall sign out')!;
    await act(async () => button.click());
    return { onSignOut, dialog: () => document.querySelector('[role="dialog"]') };
}

afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = '';
});

describe('LicenseGate sign out', () => {
    it('shows the confirm dialog with the unsynced count instead of signing out', async () => {
        const { onSignOut, dialog } = await clickPaywallSignOut(3);
        expect(onSignOut).not.toHaveBeenCalled();
        expect(dialog()?.textContent).toContain('Sign out?');
        expect(dialog()?.textContent).toContain("3 changes on this device haven't synced yet and will be lost.");
    });

    it('signs out once the dialog is confirmed', async () => {
        const { onSignOut, dialog } = await clickPaywallSignOut(0);
        const confirm = [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Sign out')!;
        await act(async () => confirm.click());
        expect(onSignOut).toHaveBeenCalledTimes(1);
    });
});
