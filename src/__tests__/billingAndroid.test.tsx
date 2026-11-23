// @vitest-environment happy-dom
/**
 * #1175: Android sells through Play once the journal-iap plugin is there, so it mounts the paid
 * pieces as iOS does: LicenseGate, the trial chip, the trial line on the sign-in page (#1282) and
 * Settings → Purchase. Without the plugin it mounts none of them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const mounted = vi.hoisted(() => [] as string[]);
vi.mock('@premium', () => ({
    LicenseGate: () => {
        mounted.push('LicenseGate');
        return null;
    },
    TrialChip: () => {
        mounted.push('TrialChip');
        return null;
    },
    WelcomeTrial: () => {
        mounted.push('WelcomeTrial');
        return null;
    },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    mounted.length = 0;
    delete window.__JOURNAL_NATIVE__;
    vi.resetModules();
});

async function mount(platform: 'ios' | 'android', plugins = ['journal-iap']) {
    window.__JOURNAL_NATIVE__ = { platform, plugins };
    const { LicenseGate, TrialChip, WelcomeTrial } = await import('@/components/license/License');
    root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root!.render(h('div', null, h(LicenseGate, { onSignOut: () => {}, pendingTotal: 0 }), h(TrialChip), h(WelcomeTrial))));
    await act(async () => {
        await import('@premium');
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

describe('paid pieces on Android', () => {
    it('should mount the gate and the chip on Android, as on iOS', async () => {
        await mount('android');
        expect(mounted.sort()).toEqual(['LicenseGate', 'TrialChip', 'WelcomeTrial']);
    });

    it('should mount nothing on Android without journal-iap', async () => {
        await mount('android', []);
        expect(mounted).toEqual([]);
    });

    it('should show Settings → Purchase on Android', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'android', plugins: ['journal-iap'] };
        const { SETTINGS_SECTIONS } = await import('@/components/settings/sections');
        expect(SETTINGS_SECTIONS.find((s) => s.id === 'license')?.hidden).toBe(false);
    });
});
