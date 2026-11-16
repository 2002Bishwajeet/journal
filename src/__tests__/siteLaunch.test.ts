/**
 * #1294: the landing site for launch. The home page leads with privacy, phone pictures sit in Apple's
 * iPhone bezel and desktop pictures in a plain macOS window, the download page has the app's three
 * getting-started steps, and the App Store and Google Play badges appear only in a build with VITE_STORES_LIVE on.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render, STORES_LIVE } from '../../site/vite.config';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const built = (file: string, stores: boolean) => render(read(`site/${file}`), { billing: true, downloads: false, stores, renew: false });
const APP_STORE = 'https://apps.apple.com/app/id6833436628';
const PLAY_ID = /applicationId = "([^"]+)"/.exec(read('src-tauri/gen/android/app/build.gradle.kts'))?.[1];

describe('the home page', () => {
    const html = built('index.html', false);

    it('leads with the privacy-first copy', () => {
        expect(html).toContain('<title>Journal: private notes, encrypted</title>');
        expect(html).toMatch(/<h1[^>]*>Private notes, encrypted\.<\/h1>/);
        expect(html).toMatch(/<meta name="description" content="Journal is an encrypted Markdown notebook\. Your notes stay home/);
        expect(html).toContain('"alternativeHeadline":"Private notes, encrypted."');
    });

    // Owner, 2026-11-16: every version is encrypted on Homebase; only Journal+ encrypts the device copy;
    // public pages are not encrypted.
    it('says precisely what is encrypted where', () => {
        expect(html).toContain('encrypted on a Homebase identity you own');
        expect(html).toContain('Journal+ encrypts this copy too.');
        expect(html).toContain('A public page is not encrypted');
    });
});

describe('the owner copy rules', () => {
    // Owner, 2026-11-16: never name the payment provider, and no coupon codes (#1302 cleans the buy page).
    it.each(['index.html', 'download.html', 'pricing.html'])('%s names no provider and no coupon', (file) => {
        const html = built(file, true);
        expect(html).not.toMatch(/Dodo|EARLYBIRD/);
    });
});

describe('the device frames', () => {
    // Apple's bezels are never committed: only composites flattened by scripts/device-frames.ts.
    it.each(['index.html', 'download.html', 'buy.html'])('hold every phone picture on %s', (file) => {
        const html = built(file, false);
        expect(html).not.toMatch(/phone-frame|phone-status/);
        const phones = [...html.matchAll(/(?:src|srcset)="\/media\/(phone-[\w-]+)\.webp"/g)].map(([, name]) => name);
        expect(phones.length).toBeGreaterThan(0);
        for (const name of phones) expect(name).toMatch(/-iphone-(light|dark)$/);
    });

    // Owner, 2026-11-16: no laptop. Desktop shots sit in a plain macOS window drawn in CSS.
    it.each(['index.html', 'download.html', 'buy.html'])('use no MacBook on %s', (file) => {
        expect(built(file, false)).not.toMatch(/-mac-(light|dark)\.(webp|mp4)/);
    });

    it.each(['index.html', 'download.html'])('put the hero video in the window on %s', (file) => {
        const html = built(file, false);
        expect(html).toMatch(/<div class="window[^"]*"[^>]*>\s*<video class="hero-video only-light"/);
        for (const theme of ['light', 'dark']) {
            expect(html).toContain(`poster="/media/hero-poster-${theme}.webp"`);
            expect(html).toContain(`src="/media/hero-${theme}.mp4"`);
        }
    });

    // How many show at once, per width, is the e2e spec's to check (site-launch.spec.ts).
    it('hold the home page pictures', () => {
        const html = built('index.html', false);
        for (const name of ['phone-live-block-iphone', 'public-page', 'phone-public-page-iphone']) {
            for (const theme of ['light', 'dark']) expect(html).toContain(`src="/media/${name}-${theme}.webp"`);
        }
    });

    it('commit no raw bezel', () => {
        const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
        expect(tracked.filter((f) => /iPhone 18|MacBook Pro M5|bezel/i.test(f) && /\.(png|psd|dmg)$/i.test(f))).toEqual([]);
    });
});

describe('the download page', () => {
    const html = built('download.html', false);

    it('has the three getting-started steps, with Homebase sign-up marked closed beta', () => {
        const steps = [...html.matchAll(/<h3 class="step-title">([^<]+)<\/h3>/g)].map(([, title]) => title);
        expect(steps).toEqual(['Install', 'Create a Homebase identity', 'Sign in']);
        expect(html).toContain('<a href="https://homebase.id">homebase.id</a>, where sign-up is in <strong>closed beta</strong>');
    });
});

describe('the store badges', () => {
    it('are off unless VITE_STORES_LIVE is true', () => {
        expect(STORES_LIVE).toBe(process.env.VITE_STORES_LIVE === 'true');
    });

    it('link the Android applicationId', () => {
        expect(PLAY_ID).toBe('com.biswa.journal');
    });

    it.each(['index.html', 'download.html'])('are absent from %s by default', (file) => {
        const html = built(file, false);
        expect(html).not.toContain('store-badges');
        expect(html).not.toContain(APP_STORE);
        expect(html).not.toContain('play.google.com');
        expect(html).not.toContain('App Store is a service mark');
    });

    it.each(['index.html', 'download.html'])('render on %s with VITE_STORES_LIVE on', (file) => {
        const html = built(file, true);
        expect(html).toContain(`href="${APP_STORE}"`);
        expect(html).toContain(`href="https://play.google.com/store/apps/details?id=${PLAY_ID}"`);
        expect(html).toContain('alt="Download on the App Store"');
        expect(html).toContain('alt="Get it on Google Play"');
        expect(html).toContain('App Store is a service mark of Apple Inc.');
    });

    it('swap the download page\'s "coming soon" lines for the store listing', () => {
        expect(built('download.html', false)).toContain('Coming soon to Google Play.');
        expect(built('download.html', true)).not.toContain('Coming soon to Google Play.');
    });
});

describe('the pricing and buy copy', () => {
    it.each(['pricing.html', 'buy.html'])('%s states the model', (file) => {
        const html = built(file, false);
        for (const words of ['3-day trial', '€24.99', '€14.99', 'year of updates', 'Journal+']) expect(html).toContain(words);
        expect(html).toMatch(/[Nn]o subscription/);
    });

    // Owner, 2026-11-16: keep it simple, and never say the desktop key works on a phone.
    it('never names a phone in a sentence about the license key', () => {
        for (const file of ['pricing.html', 'buy.html']) {
            const sentences = built(file, false)
                .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '')
                .replace(/<[^>]+>/g, '\n')
                .split(/[.?!](?!\d)|\n/); // not inside a price
            const keyed = sentences.filter((s) => /\bkey\b/.test(s));
            expect(keyed.length).toBeGreaterThan(0);
            for (const s of keyed) expect(s, file).not.toMatch(/iPhone|Android/);
            // The 5-device limit is the desktop key's, so each line with it says which devices.
            const limits = sentences.filter((s) => /up to 5\b/.test(s));
            expect(limits.length).toBeGreaterThan(0);
            for (const s of limits) expect(s, file).toMatch(/Mac, Windows (and|or) Linux/);
        }
    });
});
