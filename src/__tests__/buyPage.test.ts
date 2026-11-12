/**
 * #305: the landing site's buy page. It checks a license key with the billing Worker's own rule,
 * shows it masked, sends the right /checkout body for a new key or a renewal, reads Dodo's return
 * from the query, and keeps its buy and renew buttons out of the build until VITE_BILLING_LIVE is on.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { UserConfig } from 'vite';
import siteConfig, { BILLING_LIVE, billingBlocks } from '../../site/vite.config';
import { PAGES } from '../../site/seo';
import { checkoutBody, checkoutError, maskKey, parseLicenseKey, paymentReturn, RETURN_URL } from '../../site/src/license';

describe('parseLicenseKey', () => {
    it.each([
        ['ABCD-1234-efgh_5678', 'ABCD-1234-efgh_5678'],
        ['  abcdefgh  ', 'abcdefgh'],
        ['a'.repeat(100), 'a'.repeat(100)],
    ])('accepts %j', (input, expected) => {
        expect(parseLicenseKey(input)).toBe(expected);
    });

    it.each(['', 'short', 'abcd efgh', 'abcd.efgh', 'abcd/efgh', 'ключ-ключ-ключ', 'a'.repeat(101)])('rejects %j', (input) => {
        expect(parseLicenseKey(input)).toBeNull();
    });
});

describe('maskKey', () => {
    it('hides all but the last four characters', () => {
        const masked = maskKey('SECRET-KEY-WXYZ');
        expect(masked).toBe('••••••••WXYZ');
        expect(masked).not.toContain('SECRET');
    });
});

describe('checkoutBody', () => {
    it('buys a new key without one, renews the key it is given', () => {
        expect(checkoutBody(null)).toEqual({ returnUrl: 'https://journal.cloudx.run/landing/buy' });
        expect(checkoutBody('ABCD-1234-EFGH')).toEqual({ returnUrl: RETURN_URL, licenseKey: 'ABCD-1234-EFGH' });
        expect(JSON.stringify(checkoutBody(null))).not.toContain('odinId');
    });

    it('sends the one return URL the Worker accepts: no query, no fragment', () => {
        const url = new URL(RETURN_URL);
        expect(url.origin + url.pathname).toBe(RETURN_URL);
    });
});

describe('paymentReturn', () => {
    it('is null on a plain visit', () => {
        expect(paymentReturn('')).toBeNull();
        expect(paymentReturn('?ref=pricing')).toBeNull();
    });

    it("reads Dodo's status", () => {
        expect(paymentReturn('?payment_id=pay_1&status=succeeded&license_key=K&email=a%40b.example')).toBe('succeeded');
        expect(paymentReturn('?payment_id=pay_1&status=processing')).toBe('processing');
        expect(paymentReturn('?payment_id=pay_1&status=requires_customer_action')).toBe('processing');
        expect(paymentReturn('?payment_id=pay_1&status=failed')).toBe('failed');
        expect(paymentReturn('?payment_id=pay_1&status=cancelled')).toBe('failed');
        expect(paymentReturn('?payment_id=pay_1')).toBe('failed');
    });
});

describe('checkoutError', () => {
    it('names each failure', () => {
        expect(checkoutError(null, false)).toMatch(/connection/);
        expect(checkoutError(429, false)).toMatch(/Wait a minute/);
        expect(checkoutError(400, true)).toMatch(/could not find a license for that key/);
        expect(checkoutError(400, false)).toMatch(/Nothing was charged/);
        expect(checkoutError(502, true)).toMatch(/Nothing was charged/);
    });
});

describe('the billing flag', () => {
    const html = readFileSync(new URL('../../site/buy.html', import.meta.url), 'utf8');

    it('is off unless VITE_BILLING_LIVE is true', () => {
        expect(BILLING_LIVE).toBe(process.env.VITE_BILLING_LIVE === 'true');
    });

    it('shows "coming soon" and no buy or renew button while off', () => {
        const off = billingBlocks(html, false);
        expect(off).toContain('Native apps coming soon');
        expect(off).not.toContain('id="buy-new"');
        expect(off).not.toContain('id="renew-form"');
    });

    it('shows the buy and renew buttons, and no "coming soon", while on', () => {
        const on = billingBlocks(html, true);
        expect(on).toContain('id="buy-new"');
        expect(on).toContain('id="renew-form"');
        expect(on).not.toContain('Native apps coming soon');
    });

    it('keeps the return message either way, so a test checkout can land on the page', () => {
        for (const live of [true, false]) expect(billingBlocks(html, live)).toContain('id="buy-done"');
    });
});

describe('the buy, contact and privacy pages in the build', () => {
    const config = (mode: string) =>
        (siteConfig as (env: { mode: string; command: 'build' }) => UserConfig)({ mode, command: 'build' });

    it('are built and listed with every other page', () => {
        const input = config('production').build?.rollupOptions?.input as Record<string, string>;
        expect(PAGES.find((p) => p.id === 'buy')?.path).toBe('/landing/buy');
        expect(PAGES.find((p) => p.id === 'contact')?.path).toBe('/landing/contact');
        expect(PAGES.find((p) => p.id === 'privacy')?.path).toBe('/landing/privacy');
        for (const page of PAGES) expect(Object.values(input).some((file) => file.endsWith(`/${page.file}`))).toBe(true);
    });

    // The App Store and Google Play listings link to these two pages as the privacy policy and support URLs.
    it('links the privacy and support pages from every page footer', () => {
        const footer = readFileSync(new URL('../../site/partials/footer.html', import.meta.url), 'utf8');
        expect(footer).toContain('href="/landing/privacy"');
        expect(footer).toContain('href="/landing/contact"');
        expect(readFileSync(new URL('../../site/contact.html', import.meta.url), 'utf8')).toContain('id="support"');
    });

    it('talks to the test Worker unless built with --mode live', () => {
        expect(config('production').define?.__BILLING_URL__).toBe('"https://journal-billing-test.cloudx.run"');
        expect(config('development').define?.__BILLING_URL__).toBe('"https://journal-billing-test.cloudx.run"');
        expect(config('live').define?.__BILLING_URL__).toBe('"https://journal-billing.cloudx.run"');
    });
});
