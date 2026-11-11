/**
 * #305: the landing site's buy page. Its identity check mirrors the billing Worker's hostname rule,
 * it reads Dodo's return from the query, it tells a failed checkout apart by status, and the page
 * is built and listed like the others, against the test Worker unless the build is `--mode live`.
 */
import { describe, expect, it } from 'vitest';
import type { UserConfig } from 'vite';
import siteConfig from '../../site/vite.config';
import { PAGES } from '../../site/seo';
import { checkoutError, parseOdinId, paymentReturn } from '../../site/src/license';

describe('parseOdinId', () => {
    it.each([
        ['frodo.dotyou.cloud', 'frodo.dotyou.cloud'],
        ['Frodo.Example.COM', 'frodo.example.com'],
        ['  sam.example.com  ', 'sam.example.com'],
        ['https://sam.example.com/', 'sam.example.com'],
        ['a-b.c-d.example', 'a-b.c-d.example'],
        ['1.example', '1.example'],
    ])('accepts %j as %j', (input, expected) => {
        expect(parseOdinId(input)).toBe(expected);
    });

    it.each([
        '',
        'localhost',
        'example',
        'frodo..example.com',
        '-frodo.example.com',
        'frodo-.example.com',
        'frodo.example.123',
        'frodo.example.com/notes',
        'frodo@example.com',
        'fro do.example.com',
        '192.168.1.1',
        `${'a'.repeat(64)}.example.com`,
        `${'a.'.repeat(126)}com`,
    ])('rejects %j', (input) => {
        expect(parseOdinId(input)).toBeNull();
    });

    it('takes a 63-character label and a 253-character name, like the Worker', () => {
        expect(parseOdinId(`${'a'.repeat(63)}.example.com`)).not.toBeNull();
        expect(parseOdinId(`${'a.'.repeat(125)}com`)).toHaveLength(253);
    });
});

describe('paymentReturn', () => {
    it('is null on a plain visit or one from the app', () => {
        expect(paymentReturn('')).toBeNull();
        expect(paymentReturn('?odinId=frodo.example.com')).toBeNull();
    });

    it("reads Dodo's status", () => {
        expect(paymentReturn('?payment_id=pay_1&status=succeeded&email=a%40b.example')).toBe('succeeded');
        expect(paymentReturn('?payment_id=pay_1&status=processing')).toBe('processing');
        expect(paymentReturn('?payment_id=pay_1&status=requires_customer_action')).toBe('processing');
        expect(paymentReturn('?payment_id=pay_1&status=failed')).toBe('failed');
        expect(paymentReturn('?payment_id=pay_1&status=cancelled')).toBe('failed');
        expect(paymentReturn('?payment_id=pay_1')).toBe('failed');
    });
});

describe('checkoutError', () => {
    it('names each failure', () => {
        expect(checkoutError(null)).toMatch(/connection/);
        expect(checkoutError(429)).toMatch(/Wait a minute/);
        expect(checkoutError(400)).toMatch(/identity/);
        expect(checkoutError(502)).toMatch(/Nothing was charged/);
        expect(checkoutError(503)).toBe(checkoutError(500));
    });
});

describe('the buy page in the build', () => {
    const config = (mode: string) =>
        (siteConfig as (env: { mode: string; command: 'build' }) => UserConfig)({ mode, command: 'build' });

    it('is built and listed with every other page', () => {
        const input = config('production').build?.rollupOptions?.input as Record<string, string>;
        expect(PAGES.find((p) => p.id === 'buy')?.path).toBe('/landing/buy');
        for (const page of PAGES) expect(Object.values(input).some((file) => file.endsWith(`/${page.file}`))).toBe(true);
    });

    it('talks to the test Worker unless built with --mode live', () => {
        expect(config('production').define?.__BILLING_URL__).toBe('"https://journal-billing-test.cloudx.run"');
        expect(config('development').define?.__BILLING_URL__).toBe('"https://journal-billing-test.cloudx.run"');
        expect(config('live').define?.__BILLING_URL__).toBe('"https://journal-billing.cloudx.run"');
    });
});
