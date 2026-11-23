/**
 * #1473: the home page's download button fits the visitor's OS. Detection from the user agent (an iPad reports
 * itself as a Mac, told apart by its touch screen), the label and link each OS gets, and the built page's markup.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { downloadButton, desktopOS, visitorOS } from '../../site/src/downloads';
import { render } from '../../site/vite.config';

const UA = {
    mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
};
const RELEASE = 'https://github.com/2002Bishwajeet/journal/releases/latest/download/';

describe('visitorOS', () => {
    it('tells each platform apart', () => {
        expect(visitorOS(UA.mac)).toBe('mac');
        expect(visitorOS(UA.windows)).toBe('windows');
        expect(visitorOS(UA.linux)).toBe('linux');
        expect(visitorOS(UA.iphone)).toBe('ios');
        expect(visitorOS(UA.android)).toBe('android');
        expect(visitorOS('curl/8.0')).toBeNull();
    });

    it('takes an iPad that reports itself as a Mac for iOS, by its touch points', () => {
        expect(visitorOS(UA.mac, 5)).toBe('ios');
        expect(visitorOS(UA.mac, 0)).toBe('mac');
    });

    it('desktopOS is null on a phone or tablet', () => {
        expect(desktopOS(UA.mac)).toBe('mac');
        expect(desktopOS(UA.mac, 5)).toBeNull();
        expect(desktopOS(UA.iphone)).toBeNull();
        expect(desktopOS(UA.android)).toBeNull();
    });
});

describe('downloadButton', () => {
    it('names the desktop platform and links its installer', () => {
        expect(downloadButton('mac')).toEqual({ label: 'Download for Mac', href: `${RELEASE}Journal-darwin-universal.dmg` });
        expect(downloadButton('windows')).toEqual({ label: 'Download for Windows', href: `${RELEASE}Journal-windows-x64-setup.exe` });
        expect(downloadButton('linux')).toEqual({ label: 'Download for Linux', href: `${RELEASE}Journal-linux-amd64.AppImage` });
    });

    it('leaves iPhone and iPad to the App Store badge', () => {
        expect(downloadButton('ios')).toBeNull();
    });

    it('sends Android and unknown visitors to the download page', () => {
        expect(downloadButton('android')).toEqual({ label: 'All downloads', href: '/landing/download' });
        expect(downloadButton(null)).toEqual({ label: 'All downloads', href: '/landing/download' });
    });
});

describe('the built home page', () => {
    const page = (downloads: boolean) =>
        render(readFileSync(new URL('../../site/index.html', import.meta.url), 'utf8'), { billing: true, downloads, appstore: true, play: false, renew: false });

    it('has a plain Download link to the download page as the no-script default', () => {
        const html = page(true);
        expect(html.match(/<a class="btn btn-primary" href="\/landing\/download" data-download>Download<\/a>/g)).toHaveLength(2);
        expect(html).toContain('<a href="/landing/download">Other platforms</a>');
        expect(html).toContain('/src/heroDownload.ts');
    });

    it('keeps the hero as it was with downloads off', () => {
        const html = page(false);
        expect(html).not.toContain('data-download');
        expect(html).not.toContain('Other platforms');
        expect(html).not.toContain('releases/latest/download');
        expect(html).toContain('<a class="btn btn-primary" href="/welcome">Open Journal</a>');
    });
});
