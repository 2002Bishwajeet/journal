/**
 * #1294: the landing site for launch. The home page leads with privacy, phone pictures sit in Apple's
 * iPhone bezel and desktop pictures in a plain macOS window, the download page has the app's three
 * getting-started steps, and the App Store and Google Play badges appear only in a build with VITE_STORES_LIVE on.
 * #1455: that flag is split in two, VITE_APPSTORE_LIVE (on in the deploy) and VITE_PLAY_LIVE (off: "Android: coming later").
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { APPSTORE_LIVE, PLAY_LIVE, render } from '../../site/vite.config';

/** The page's text nodes outside script, style and comments, parsed rather than regex-stripped (CodeQL). */
const textNodes = (html: string) => {
    const doc = new new Window().DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style').forEach((el) => el.remove());
    const walker = doc.createTreeWalker(doc.documentElement, 4 /* NodeFilter.SHOW_TEXT */);
    const out: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) out.push(node.textContent ?? '');
    return out;
};

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
type Stores = { appstore: boolean; play: boolean };
const OFF: Stores = { appstore: false, play: false };
const DEPLOYED: Stores = { appstore: true, play: false };
const BOTH: Stores = { appstore: true, play: true };
const built = (file: string, stores: Stores = OFF) => render(read(`site/${file}`), { billing: true, downloads: true, renew: false, ...stores });
const APP_STORE = 'https://apps.apple.com/app/id6833436628';
const PLAY_ID = /applicationId = "([^"]+)"/.exec(read('src-tauri/gen/android/app/build.gradle.kts'))?.[1];

describe('the home page', () => {
    const html = built('index.html');

    it('leads with the privacy-first copy', () => {
        expect(html).toContain('<title>Journal: private notes, encrypted</title>');
        expect(html).toMatch(/<h1[^>]*>Private notes, encrypted\.<\/h1>/);
        expect(html).toMatch(/<meta name="description" content="Journal is an encrypted Markdown notebook\. Your notes stay home/);
        expect(html).toContain('"alternativeHeadline":"Private notes, encrypted."');
    });

    // Owner, 2026-11-16: every version is encrypted on Homebase; only the native apps encrypt the device copy;
    // public pages are not encrypted.
    it('says precisely what is encrypted where', () => {
        expect(html).toContain('encrypted on a Homebase identity you own');
        expect(html).toContain('The Journal apps encrypt this copy too.');
        expect(html).toContain('A public page is not encrypted');
    });
});

describe('the owner copy rules', () => {
    // Owner, 2026-11-16: never name the payment provider, and no coupon codes (#1302 cleans the buy page).
    it.each(['index.html', 'download.html', 'pricing.html'])('%s names no provider and no coupon', (file) => {
        const html = built(file, BOTH);
        expect(html).not.toMatch(/Dodo|EARLYBIRD/);
    });
});

describe('the device frames', () => {
    // Apple's bezels are never committed: only composites flattened by scripts/device-frames.ts.
    it.each(['index.html', 'download.html', 'buy.html'])('hold every phone picture on %s', (file) => {
        const html = built(file);
        expect(html).not.toMatch(/phone-frame|phone-status/);
        const phones = [...html.matchAll(/(?:src|srcset)="\/media\/(phone-[\w-]+)\.webp"/g)].map(([, name]) => name);
        expect(phones.length).toBeGreaterThan(0);
        for (const name of phones) expect(name).toMatch(/-iphone-(light|dark)$/);
    });

    // Owner, 2026-11-16: no laptop. Desktop shots sit in a plain macOS window drawn in CSS.
    it.each(['index.html', 'download.html', 'buy.html'])('use no MacBook on %s', (file) => {
        expect(built(file)).not.toMatch(/-mac-(light|dark)\.(webp|mp4)/);
    });

    it.each(['index.html', 'download.html'])('put the hero video in the window on %s', (file) => {
        const html = built(file);
        expect(html).toMatch(/<div class="window[^"]*"[^>]*>\s*<video class="hero-video only-light"/);
        for (const theme of ['light', 'dark']) {
            expect(html).toContain(`poster="/media/hero-poster-${theme}.webp"`);
            expect(html).toContain(`src="/media/hero-${theme}.mp4"`);
        }
    });

    // How many show at once, per width, is the e2e spec's to check (site-launch.spec.ts).
    it('hold the home page pictures', () => {
        const html = built('index.html');
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
    const html = built('download.html');

    it('has the three getting-started steps, with Homebase sign-up marked closed beta', () => {
        const steps = [...html.matchAll(/<h3 class="step-title">([^<]+)<\/h3>/g)].map(([, title]) => title);
        expect(steps).toEqual(['Install', 'Create a Homebase identity', 'Sign in']);
        expect(html).toContain('<a href="https://homebase.id">homebase.id</a>, where sign-up is in <strong>closed beta</strong>');
    });

    // #1456: what the apps add, only features with a released entry in RELEASE_NOTES.md, right after the hero.
    it('lists what the apps add, after the hero and before getting started', () => {
        const section = /<section[^>]*id="apps-add"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
        const heads = [...section.matchAll(/<h3 class="h3">([^<]+)<\/h3>/g)].map(([, title]) => title);
        expect(heads).toEqual([
            'Your notes are encrypted on your device too',
            'Lock the app, or one note or folder',
            'Jot a note from anywhere',
            'Stays running, starts at login, updates itself',
            'Share links open in the app',
            "Writing help from Apple's on-device model",
        ]);
        expect(section).toMatch(/Everything else is the same Journal you use in the browser, which stays free\.<\/p>\s*<\/div>\s*<\/section>$/);
        // The native export save (#1205) is listed only once its release note is out of release-notes/.
        expect(section).not.toMatch(/share sheet|Save dialog/i);
        expect(html.indexOf('id="apps-add"')).toBeGreaterThan(html.indexOf('id="download-title"'));
        expect(html.indexOf('id="apps-add"')).toBeLessThan(html.indexOf('id="start-title"'));
    });

    it('names Android in what the apps add only once the Play app is live', () => {
        const section = (stores: Stores) => textNodes(/<section[^>]*id="apps-add"[\s\S]*?<\/section>/.exec(built('download.html', stores))?.[0] ?? '').join('');
        expect(section(DEPLOYED)).not.toContain('Android');
        expect(section(BOTH)).toContain('iPhone, iPad, Android, Mac and Windows.');
        expect(section(BOTH)).toContain('On Android, an experimental option in Settings.');
    });
});

describe('the store badges', () => {
    const PAGES = ['index.html', 'download.html', 'buy.html'];
    const PLAY = 'play.google.com';

    it('follow VITE_APPSTORE_LIVE and VITE_PLAY_LIVE', () => {
        expect(APPSTORE_LIVE).toBe(process.env.VITE_APPSTORE_LIVE === 'true');
        expect(PLAY_LIVE).toBe(process.env.VITE_PLAY_LIVE === 'true');
    });

    it('are on for the App Store and off for Google Play in the deploy', () => {
        const deploy = read('.github/workflows/deploy-cloudflare.yml');
        expect(deploy).toContain("VITE_APPSTORE_LIVE: 'true'");
        expect(deploy).toContain("VITE_PLAY_LIVE: 'false'");
        expect(deploy).not.toContain('VITE_STORES_LIVE');
    });

    it('link the Android applicationId', () => {
        expect(PLAY_ID).toBe('com.biswa.journal');
    });

    it.each(PAGES)('are absent from %s with both flags off', (file) => {
        const html = built(file);
        expect(html).not.toContain('store-badges');
        expect(html).not.toContain(APP_STORE);
        expect(html).not.toContain(PLAY);
        expect(html).not.toContain('App Store is a service mark');
        expect(html).not.toContain('Google Play logo');
    });

    it.each(PAGES)('show the App Store badge on %s, and "Android: coming later" instead of a Play badge', (file) => {
        const html = built(file, DEPLOYED);
        expect(html).toContain(`href="${APP_STORE}"`);
        expect(html).toContain('alt="Download on the App Store"');
        expect(html).toContain('Android: coming later');
        expect(html).not.toContain(PLAY);
        expect(html).not.toContain('alt="Get it on Google Play"');
        // The footer credits only the badge that is shown.
        expect(html).toContain('App Store is a service mark of Apple Inc.');
        expect(html).not.toContain('Google Play logo');
    });

    it.each(PAGES)('show both badges on %s with Play on too, the App Store first', (file) => {
        const html = built(file, BOTH);
        const apple = html.indexOf(`href="${APP_STORE}"`);
        expect(apple).toBeGreaterThan(-1);
        expect(html.indexOf(`href="https://play.google.com/store/apps/details?id=${PLAY_ID}"`)).toBeGreaterThan(apple);
        expect(html).toContain('alt="Get it on Google Play"');
        expect(html).toContain('Google Play and the Google Play logo are trademarks of Google LLC.');
        expect(html).not.toContain('Android: coming later');
    });

    it('show the official App Store badge unmodified, at least 40px tall', () => {
        const badge = /<img src="\/badges\/app-store\.svg" width="(\d+)" height="(\d+)"/.exec(read('site/partials/store-badges.html'));
        expect(Number(badge?.[2])).toBeGreaterThanOrEqual(40);
        expect(read('site/src/styles.css')).toMatch(/\.store-badge img \{ height: 48px; width: auto; \}/);
    });
});

describe('the app status', () => {
    const pages = ['index.html', 'download.html', 'pricing.html', 'buy.html'];
    const text = (html: string) => textNodes(html).join(' ').replace(/\s+/g, ' ');

    it.each(pages)('%s says no "coming soon" and no TestFlight as deployed', (file) => {
        const html = built(file, DEPLOYED);
        expect(html).not.toMatch(/coming soon|TestFlight/i);
    });

    it.each(['site/llms.txt', 'public/llms.txt'])('%s says no "coming soon" and no TestFlight', (file) => {
        expect(read(file)).not.toMatch(/coming soon|TestFlight/i);
    });

    it('never lists Android as available while Play is off', () => {
        for (const file of pages) {
            const html = text(built(file, DEPLOYED));
            expect(html, file).not.toMatch(/iPhone, (iPad, )?Android, Mac/);
        }
        expect(text(built('index.html', DEPLOYED))).toContain('Android is coming later.');
        expect(text(built('index.html', BOTH))).toMatch(/iPhone, iPad, Android, Mac, Windows and Linux/);
    });

    it('says how iPhone and iPad unlock on Pricing and Buy', () => {
        for (const file of ['pricing.html', 'buy.html']) {
            expect(built(file, DEPLOYED), file).toContain('On iPhone and iPad, unlock in the app at the App Store price; restore with your Apple Account');
        }
    });
});

describe('the download links', () => {
    it.each(['index.html', 'download.html', 'pricing.html', 'buy.html'])('%s has Download in the header and footer', (file) => {
        const html = built(file, DEPLOYED);
        const header = /<header class="nav">[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
        const footer = /<footer class="footer">[\s\S]*?<\/footer>/.exec(html)?.[0] ?? '';
        expect(header).toMatch(/<a href="\/landing\/download"[^>]*>Download<\/a>/);
        expect(footer).toMatch(/<a href="\/landing\/download"[^>]*>Download<\/a>/);
    });

    it.each(['index.html', 'pricing.html', 'buy.html'])('%s links the download page from its content', (file) => {
        const main = /<main[\s\S]*?<\/main>/.exec(built(file, DEPLOYED))?.[0];
        expect(main).toContain('href="/landing/download"');
    });

    it('marks Download current on the download page', () => {
        expect(built('download.html', DEPLOYED)).toMatch(/<a href="\/landing\/download" aria-current="page">Download<\/a>/);
    });
});

describe('the home page Homebase lines', () => {
    it('says what Homebase is, and that sign-up is a closed beta with a wait list', () => {
        const html = built('index.html', DEPLOYED);
        expect(html).toContain('gives you a private web address that holds your data. Journal signs in with it.');
        expect(html).toContain('sign-up is a closed beta with a wait list');
    });
});

describe('the pricing and buy copy', () => {
    it.each(['pricing.html', 'buy.html'])('%s states the model', (file) => {
        const html = built(file, DEPLOYED);
        for (const words of ['3-day trial', '€24.99', '€14.99', 'year of updates', 'Journal apps']) expect(html).toContain(words);
        expect(html).toMatch(/[Nn]o subscription/);
    });

    // Owner, 2026-11-16: keep it simple, and never say the desktop key works on a phone.
    it('never names a phone in a sentence about the license key', () => {
        for (const file of ['pricing.html', 'buy.html']) {
            const sentences = textNodes(built(file, DEPLOYED))
                .join('\n')
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
