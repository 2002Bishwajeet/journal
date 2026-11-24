/**
 * #305 / #1141: the desktop release. The updater config, the desktop app name, the installer
 * names desktop-release.yml uploads, and the download page that links them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOWNLOADS_LIVE, flagBlocks } from '../../site/vite.config';
import { PAGES } from '../../site/seo';
import { desktopOS } from '../../site/src/downloads';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const json = (file: string) => JSON.parse(read(file));
const LATEST = 'https://github.com/2002Bishwajeet/journal/releases/latest/download';

describe('the updater', () => {
    const { plugins } = json('src-tauri/tauri.conf.json');

    it("reads latest.json from the newest GitHub release, where desktop-release.yml puts it", () => {
        expect(plugins.updater.endpoints).toEqual([`${LATEST}/latest.json`]);
    });

    it('verifies updates against a minisign public key', () => {
        expect(atob(plugins.updater.pubkey)).toMatch(/^untrusted comment: minisign public key: [0-9A-F]+\n/);
    });

    it('signs updater bundles only in the release build, so anyone can build without the key', () => {
        expect(json('src-tauri/tauri.conf.json').bundle.createUpdaterArtifacts).toBeUndefined();
        expect(json('src-tauri/tauri.release.conf.json').bundle.createUpdaterArtifacts).toBe(true);
        expect(read('.github/workflows/desktop-release.yml')).toContain('--config src-tauri/tauri.release.conf.json');
    });
});

// #1340: every local build is "Journal Dev"; only the release workflows opt in to the real names.
describe('the app name', () => {
    it.each(['macos', 'windows', 'linux'])('is Journal Dev on %s by default', (os) => {
        expect(json(`src-tauri/tauri.${os}.conf.json`).productName).toBe('Journal Dev');
    });

    it('is Journal Dev in the base config, which the iOS and Android projects are generated from', () => {
        expect(json('src-tauri/tauri.conf.json').productName).toBe('Journal Dev');
    });

    it('keeps the bundle identifier, so the data dir, deep links and signing do not change', () => {
        expect(json('src-tauri/tauri.conf.json').identifier).toBe('com.biswa.journal');
    });

    it('is Journal in the release config', () => {
        expect(json('src-tauri/tauri.release.conf.json').productName).toBe('Journal');
    });

    it('is the real name on desktop only where desktop-release.yml merges the release config', () => {
        expect(read('.github/workflows/desktop-release.yml')).toContain('--config src-tauri/tauri.release.conf.json');
    });

    it.each(['ios-release.yml', 'android-release.yml'])('is the real name only where %s sets JOURNAL_RELEASE_BUILD', (file) => {
        expect(read(`.github/workflows/${file}`).match(/^\s+JOURNAL_RELEASE_BUILD: '1'$/gm)).toHaveLength(1);
    });

    it('is swapped to Journal+ on iOS and Android only under JOURNAL_RELEASE_BUILD', () => {
        for (const script of ['scripts/ios-project.mjs', 'scripts/android-release.mjs']) {
            expect(read(script)).toContain("process.env.JOURNAL_RELEASE_BUILD === '1'");
        }
        expect(read('src-tauri/Info.ios.plist')).toContain('<string>Journal Dev</string>');
    });
});

describe('the download page', () => {
    const html = read('site/download.html');
    const links = (page: string) => [...page.matchAll(/href="(https:\/\/github\.com\/[^"]+\/releases\/latest\/download\/[^"]+)"/g)].map((m) => m[1]);

    it('is built and listed', () => {
        expect(PAGES.find((p) => p.id === 'download')?.path).toBe('/landing/download');
    });

    it('links the names the release workflow gives its assets', () => {
        // The ARM rows' `arch: arm64` replaces tauri-action's [arch] (#1484); the x64 and Mac rows keep it.
        expect(read('.github/workflows/desktop-release.yml')).toContain(
            `releaseAssetNamePattern: "Journal-[platform]-\${{ matrix.arch || '[arch]' }}[setup][ext]"`,
        );
        expect(links(html).sort()).toEqual(
            [
                'Journal-darwin-universal.dmg',
                'Journal-windows-x64-setup.exe',
                'Journal-windows-x64.msi',
                'Journal-windows-arm64-setup.exe',
                'Journal-windows-arm64.msi',
                'Journal-linux-amd64.AppImage',
                'Journal-linux-amd64.deb',
                'Journal-linux-arm64.AppImage',
                'Journal-linux-arm64.deb',
                'SHA256SUMS.txt',
            ]
                .map((file) => `${LATEST}/${file}`)
                .sort(),
        );
    });

    it('is off unless VITE_DOWNLOADS_LIVE is true', () => {
        expect(DOWNLOADS_LIVE).toBe(process.env.VITE_DOWNLOADS_LIVE === 'true');
    });

    it('shows "coming soon" and no installer while off, and the installers while on', () => {
        const off = flagBlocks(html, 'downloads', false);
        expect(off).toContain('Desktop apps coming soon');
        expect(links(off)).toEqual([]);
        const on = flagBlocks(html, 'downloads', true);
        expect(on).not.toContain('Desktop apps coming soon');
        expect(links(on)).toHaveLength(10);
    });
});

// #1484: native ARM64 Windows and Linux builds on GitHub's ARM runners, each in latest.json.
describe('the ARM64 builds', () => {
    const workflow = read('.github/workflows/desktop-release.yml');

    it.each([
        ['windows-11-arm', 'nsis,msi'],
        ['ubuntu-22.04-arm', 'appimage,deb'],
    ])('builds on %s with %s, named arm64', (os, bundles) => {
        expect(workflow).toContain(`- os: ${os}\n            args: --bundles ${bundles}\n            arch: arm64\n`);
    });

    it('checks every platform made it into latest.json', () => {
        expect(workflow).toContain(
            'for platform in darwin-aarch64 darwin-x86_64 windows-x86_64 windows-aarch64 linux-x86_64 linux-aarch64; do',
        );
    });

    it('gives each build its own workflow artifact, so the two Windows and two Linux builds never clash', () => {
        expect(workflow).toContain('name: desktop-${{ runner.os }}-${{ runner.arch }}');
    });
});

describe('desktopOS', () => {
    it.each([
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'mac'],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', 'windows'],
        ['Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0', 'linux'],
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', null],
        ['Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', null],
        ['curl/8.0', null],
    ])('%s -> %s', (ua, os) => {
        expect(desktopOS(ua)).toBe(os);
    });
});
