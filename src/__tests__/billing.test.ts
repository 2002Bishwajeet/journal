import { describe, it, expect, afterEach, vi } from 'vitest';

describe('licenseEnabled', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('should be off without VITE_BILLING_URL, even in the native app', async () => {
        vi.stubEnv('VITE_BILLING_URL', '');
        vi.stubGlobal('window', { __JOURNAL_NATIVE__: { platform: 'macos' } });
        const { BILLING_URL, licenseEnabled } = await import('@/lib/billing');
        expect(BILLING_URL).toBeNull();
        expect(licenseEnabled()).toBe(false);
    });

    it('should be on only in the native app of a build with a billing Worker', async () => {
        vi.stubEnv('VITE_BILLING_URL', 'https://billing.example.test');
        vi.stubGlobal('window', {});
        const web = await import('@/lib/billing');
        expect(web.licenseEnabled()).toBe(false);

        vi.stubGlobal('window', { __JOURNAL_NATIVE__: { platform: 'macos' } });
        expect(web.licenseEnabled()).toBe(true);
    });
});
