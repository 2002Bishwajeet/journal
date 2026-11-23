// @vitest-environment happy-dom
/**
 * #1464: the invite redeem page (/landing/redeem?code=…). It strips the code from the address, asks the
 * billing Worker for a lifetime key with an optional email, shows the key once with Copy and Save, and
 * names each failure without repeating the code. The Worker is a mocked fetch.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserConfig } from 'vite';
import siteConfig, { render } from '../../site/vite.config';
import { PAGES, siteFiles } from '../../site/seo';
import { keyFile, maskCode, redeemBody, redeemError } from '../../site/src/invite';

// Paths from the repo root, not `new URL(…, import.meta.url)`: under happy-dom Vite turns that into an asset import.
const ROOT = resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8');
const html = read('site/redeem.html');
const WORKER = 'https://billing.test';
const CODE = 'K7Q2-9XMA-ALEX';
const KEY = 'JRNL-LIFE-0000-ABCD';

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const flush = () => new Promise((done) => setTimeout(done, 0));

/** The page at `search`, with its script run fresh and the Worker answering `answer`. */
async function open(search: string, answer: () => Promise<Response>) {
    history.replaceState(null, '', `/landing/redeem${search}`);
    document.body.innerHTML = /<main[^>]*>[\s\S]*<\/main>/.exec(html)![0];
    const fetchMock = vi.fn<typeof fetch>(() => answer());
    vi.stubGlobal('fetch', fetchMock);
    vi.resetModules();
    await import('../../site/src/redeem');
    return fetchMock;
}

async function getKey() {
    $<HTMLFormElement>('#redeem-form').requestSubmit();
    await flush();
    await flush();
}

const json = (status: number, body: unknown) => () => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
    (globalThis as { __BILLING_URL__?: string }).__BILLING_URL__ = WORKER;
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('the invite link', () => {
    it('strips the code from the address on load and shows it masked', async () => {
        await open(`?code=${CODE}`, json(200, { licenseKey: KEY }));
        expect(location.search).toBe('');
        expect(location.href).not.toContain(CODE);
        expect($('#redeem-code').hidden).toBe(false);
        expect($('#redeem-code-masked').textContent).toBe('K7Q2-••••-••••');
        expect($('#redeem-code-field').hidden).toBe(true);
        expect(document.body.textContent).not.toContain('9XMA');
    });

    it('shows a code field when the address has no code', async () => {
        await open('', json(200, { licenseKey: KEY }));
        expect($('#redeem-code').hidden).toBe(true);
        expect($('#redeem-code-field').hidden).toBe(false);
    });

    it('sends the typed code when there is none in the address, and asks for one when it is empty', async () => {
        const fetchMock = await open('', json(200, { licenseKey: KEY }));
        await getKey();
        expect(fetchMock).not.toHaveBeenCalled();
        expect($('#redeem-status').textContent).toBe('Enter the code from your invite.');

        $<HTMLInputElement>('#redeem-code-input').value = ` ${CODE} `;
        await getKey();
        expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ code: CODE });
    });
});

describe('getting the key', () => {
    it('posts the code without an email, since the email is optional', async () => {
        const fetchMock = await open(`?code=${CODE}`, json(200, { licenseKey: KEY }));
        await getKey();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${WORKER}/invite/redeem`);
        expect(init?.method).toBe('POST');
        expect(JSON.parse(init!.body as string)).toEqual({ code: CODE });
    });

    it('posts the email when one is given, and catches an incomplete one first', async () => {
        const fetchMock = await open(`?code=${CODE}`, json(200, { licenseKey: KEY }));
        const email = $<HTMLInputElement>('#redeem-email');
        email.value = 'alex@';
        await getKey();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(email.getAttribute('aria-invalid')).toBe('true');

        email.value = 'alex@example.com';
        await getKey();
        expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ code: CODE, email: 'alex@example.com' });
    });

    it('shows the key once it comes, and hides the form', async () => {
        await open(`?code=${CODE}`, json(200, { licenseKey: KEY }));
        await getKey();
        expect($('#redeem-form').hidden).toBe(true);
        expect($('#redeem-done').hidden).toBe(false);
        expect($('#redeem-key').textContent).toBe(KEY);
        expect($('#redeem-done').textContent).toContain("Save this key now. It's only shown once.");
        expect($('#redeem-done a[href="/landing/download"]')).not.toBeNull();
    });

    it('copies the key', async () => {
        await open(`?code=${CODE}`, json(200, { licenseKey: KEY }));
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        await getKey();
        $('#redeem-copy').click();
        await flush();
        expect(writeText).toHaveBeenCalledWith(KEY);
        expect($('#redeem-copy').textContent).toBe('Copied');
        expect($('#redeem-saved').textContent).toMatch(/^Key copied\./);
    });

    it('saves the key as a text file, in the browser', async () => {
        const fetchMock = await open(`?code=${CODE}`, json(200, { licenseKey: KEY }));
        const blobs: Blob[] = [];
        vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => (blobs.push(blob as Blob), 'blob:key'));
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            expect(this.download).toBe('journal-license-key.txt');
            expect(this.href).toBe('blob:key');
        });
        await getKey();
        $('#redeem-save').click();
        expect(clicked).toHaveBeenCalledOnce();
        expect($('#redeem-saved').textContent).toContain('journal-license-key.txt');
        expect(await blobs[0].text()).toContain(KEY);
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});

describe('the errors', () => {
    it.each([
        [404, /isn't valid any more/],
        [429, /Too many tries\. Wait a minute/],
        [500, /Try again in a few minutes/],
    ])('names a %i', async (status, message) => {
        await open(`?code=${CODE}`, json(status, { error: 'invite_not_valid' }));
        await getKey();
        expect($('#redeem-status').textContent).toMatch(message);
        expect($('#redeem-done').hidden).toBe(true);
        expect(document.body.textContent).not.toContain(CODE);
    });

    it('lets a network error be retried', async () => {
        let reachable = false;
        await open(`?code=${CODE}`, () => (reachable ? json(200, { licenseKey: KEY })() : Promise.reject(new TypeError('Failed to fetch'))));
        await getKey();
        expect($('#redeem-status').textContent).toMatch(/Check your connection and try again/);
        expect($<HTMLButtonElement>('#redeem-form button[type="submit"]').disabled).toBe(false);

        reachable = true;
        await getKey();
        expect($('#redeem-key').textContent).toBe(KEY);
    });

    it('never repeat the code', () => {
        for (const status of [null, 400, 404, 429, 500]) expect(redeemError(status)).not.toMatch(/code/i);
    });
});

describe('the rules', () => {
    it('masks all but the first four characters', () => {
        expect(maskCode(CODE)).toBe('K7Q2-••••-••••');
        expect(maskCode('FRIENDS2026')).toBe('FRIE•••••••');
    });

    it('builds the body and the file', () => {
        expect(redeemBody(CODE, '')).toEqual({ code: CODE });
        expect(redeemBody(CODE, 'a@b.example')).toEqual({ code: CODE, email: 'a@b.example' });
        expect(keyFile(KEY)).toContain(KEY);
    });
});

describe('the page in the build', () => {
    it('is built, but kept out of the nav, the sitemap and search', () => {
        const config = (siteConfig as (env: { mode: string; command: 'build' }) => UserConfig)({ mode: 'production', command: 'build' });
        const input = config.build?.rollupOptions?.input as Record<string, string>;
        expect(input.redeem).toMatch(/\/redeem\.html$/);
        expect(PAGES.map((p) => p.file as string)).not.toContain('redeem.html');
        const files = siteFiles(render, resolve(ROOT, 'site'));
        expect(files['sitemap.xml']).not.toContain('redeem');
        expect(read('site/partials/header.html')).not.toContain('redeem');
        expect(read('site/partials/footer.html')).not.toContain('redeem');
    });

    it('sends no referrer, is not cached and not indexed, and loads no third-party script', () => {
        const built = render(html, { billing: true, downloads: true, stores: true, renew: true });
        expect(built).toContain('<meta name="referrer" content="no-referrer" />');
        expect(built).toContain('<meta name="robots" content="noindex, nofollow" />');
        expect(built).not.toContain('rel="canonical"');
        expect([...built.matchAll(/<script[^>]*src="([^"]+)"/g)].map(([, src]) => src).every((src) => src.startsWith('/'))).toBe(true);
        const headers = /\/landing\/redeem\*\n((?: {2}.+\n)+)/.exec(read('public/_headers'))?.[1] ?? '';
        expect(headers).toContain('Referrer-Policy: no-referrer');
        expect(headers).toContain('Cache-Control: no-store');
    });
});
