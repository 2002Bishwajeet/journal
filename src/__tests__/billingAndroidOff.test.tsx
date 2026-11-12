// @vitest-environment happy-dom
/**
 * #1215 audit F2: with journal-iap listed (plugins.txt is one list) but Play billing not shipped,
 * Android mounts none of the paid pieces: no LicenseGate (whose license read starts the trial
 * clock), no trial chip, no Settings → Purchase.
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

async function mount(platform: 'ios' | 'android') {
    window.__JOURNAL_NATIVE__ = { platform, plugins: ['journal-iap'] };
    const { LicenseGate, TrialChip } = await import('@/components/license/License');
    root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root!.render(h('div', null, h(LicenseGate, { onSignOut: () => {}, pendingTotal: 0 }), h(TrialChip))));
    await act(async () => {
        await import('@premium');
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

describe('paid pieces on Android before Play billing ships', () => {
    it('should mount nothing on Android, while iOS mounts the gate and the chip', async () => {
        await mount('android');
        expect(mounted).toEqual([]);
        await act(async () => root?.unmount());
        root = undefined;

        await mount('ios');
        expect(mounted.sort()).toEqual(['LicenseGate', 'TrialChip']);
    });

    it('should hide Settings → Purchase on Android', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'android', plugins: ['journal-iap'] };
        const { SETTINGS_SECTIONS } = await import('@/components/settings/sections');
        expect(SETTINGS_SECTIONS.find((s) => s.id === 'license')?.hidden).toBe(true);
    });
});
