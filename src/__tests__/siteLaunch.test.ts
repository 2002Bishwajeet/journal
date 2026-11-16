/**
 * #1294: the landing site for launch. The home page leads with privacy, the phone pictures sit in the
 * one shared phone frame, the download page has the app's three getting-started steps, and the
 * App Store and Google Play badges appear only in a build with VITE_STORES_LIVE on.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render, STORES_LIVE } from '../../site/vite.config';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const built = (file: string, stores: boolean) => render(read(`site/${file}`), { billing: true, downloads: false, stores });
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
});

describe('the phone frame', () => {
    it.each(['index.html', 'download.html', 'buy.html'])('holds every phone picture on %s, with the shared status bar', (file) => {
        const html = built(file, false);
        expect(html).not.toMatch(/class="phone /);
        const frames = html.match(/class="phone-frame /g)?.length ?? 0;
        expect(frames).toBeGreaterThan(0);
        expect(html.match(/class="phone-status"/g)).toHaveLength(frames);
        expect(html).not.toContain('<!-- phone-status -->');
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
                .split(/[.?!\n]/);
            const keyed = sentences.filter((s) => /\bkey\b/.test(s));
            expect(keyed.length).toBeGreaterThan(0);
            for (const s of keyed) expect(s, file).not.toMatch(/iPhone|Android/);
        }
    });
});
