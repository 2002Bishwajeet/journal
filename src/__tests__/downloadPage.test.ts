// @vitest-environment happy-dom
/**
 * #1475: the download page shows the visitor's OS as the one download, the others under "Other platforms".
 * #1484: on an ARM CPU, Windows and Linux show their ARM64 build instead.
 * The CPU logic, which card is shown and which are collapsed, and the built page without script.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cpuArch, desktopOS, layoutDownloads, showArch } from '../../site/src/downloads';
import { render } from '../../site/vite.config';

describe('cpuArch', () => {
    it('reads x64 and ARM from userAgentData', () => {
        expect(cpuArch({ architecture: 'x86', bitness: '64' })).toBe('x64');
        expect(cpuArch({ architecture: 'arm', bitness: '64' })).toBe('arm');
    });

    it('stays unknown without userAgentData (Safari, Firefox) or for 32-bit x86', () => {
        expect(cpuArch(null)).toBeNull();
        expect(cpuArch({})).toBeNull();
        expect(cpuArch({ architecture: 'x86', bitness: '32' })).toBeNull();
    });

    it('reads ARM from the user agent of Firefox on Linux', () => {
        expect(cpuArch(null, 'Mozilla/5.0 (X11; Linux aarch64; rv:133.0) Gecko/20100101 Firefox/133.0')).toBe('arm');
        expect(cpuArch(null, 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0')).toBeNull();
    });
});

describe('the built download page without script', () => {
    const source = readFileSync(resolve(process.cwd(), 'site/download.html'), 'utf8');
    const html = render(source, { billing: true, downloads: true, renew: false, appstore: false, play: false });

    it('still lists every platform, the ARM64 builds next to x64, with nothing collapsed', () => {
        expect([...html.matchAll(/<li class="dl-item" data-os="(\w+)"( data-arch="arm")?>/g)].map(([, os, arm]) => os + (arm ? '-arm' : ''))).toEqual([
            'mac',
            'windows',
            'windows-arm',
            'linux',
            'linux-arm',
        ]);
        expect(html).not.toContain('Other platforms');
        expect(html).toContain('Journal-darwin-universal.dmg');
        expect(html).toContain('Journal-windows-x64-setup.exe');
        expect(html).toContain('Journal-windows-arm64-setup.exe');
        expect(html).toContain('Journal-linux-amd64.AppImage');
        expect(html).toContain('Journal-linux-arm64.AppImage');
    });

    it('no longer says ARM needs emulation or has no build', () => {
        expect(html).not.toMatch(/emulation|no ARM build/);
    });
});

describe('layoutDownloads', () => {
    const load = () => new DOMParser().parseFromString(render(source, flags), 'text/html');
    const source = readFileSync(resolve(process.cwd(), 'site/download.html'), 'utf8');
    const flags = { billing: true, downloads: true, renew: false, appstore: false, play: false };
    const agents = {
        mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
        windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36',
        linux: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537.36',
    } as const;

    const featured = (doc: Document) => [...doc.querySelectorAll<HTMLElement>('.dl-item')].filter((li) => !li.closest('.dl-other'));
    const collapsed = (doc: Document) => [...doc.querySelectorAll<HTMLElement>('details.dl-other .dl-item')];

    it.each(['mac', 'windows', 'linux'] as const)('shows the x64 or universal %s card and collapses the others', (os) => {
        const doc = load();
        const shown = layoutDownloads(doc, desktopOS(agents[os]));
        expect(shown?.dataset.os).toBe(os);
        expect(shown?.dataset.arch).toBeUndefined();
        expect(shown?.querySelector('.btn')?.classList.contains('btn-primary')).toBe(true);
        expect(collapsed(doc)).toHaveLength(4);
        expect(collapsed(doc)).not.toContain(shown);
        expect(featured(doc)).toEqual([shown]);
    });

    it.each([
        ['a phone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1'],
        ['Android', 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36'],
        ['an unknown agent', 'curl/8.0'],
    ])('leaves every card listed for %s', (_, ua) => {
        const doc = load();
        expect(layoutDownloads(doc, desktopOS(ua))).toBeNull();
        expect(featured(doc)).toHaveLength(5);
        expect(doc.querySelector('details.dl-other')).toBeNull();
    });

    describe('showArch', () => {
        const button = (card: HTMLElement) => card.querySelector<HTMLAnchorElement>('.btn')!;

        it.each([
            ['windows', 'Journal-windows-arm64-setup.exe', 'Journal-windows-arm64.msi', 'Journal-windows-x64-setup.exe'],
            ['linux', 'Journal-linux-arm64.AppImage', 'Journal-linux-arm64.deb', 'Journal-linux-amd64.AppImage'],
        ] as const)('offers the ARM64 build on %s on ARM, and folds the x64 one', (os, installer, other, x64) => {
            const doc = load();
            const shown = showArch(layoutDownloads(doc, os)!, 'arm');
            expect(shown.dataset.arch).toBe('arm');
            expect(featured(doc)).toEqual([shown]);
            expect(button(shown).href).toContain(installer);
            expect(button(shown).classList.contains('btn-primary')).toBe(true);
            expect(shown.querySelector(`a[href$="${other}"]`)).not.toBeNull();
            const folded = collapsed(doc).find((li) => li.dataset.os === os)!;
            expect(button(folded).href).toContain(x64);
            expect(button(folded).classList.contains('btn-secondary')).toBe(true);
            expect(collapsed(doc)).toHaveLength(4);
        });

        it.each(['x64', null] as const)('keeps the x64 build for a %s CPU', (arch) => {
            for (const [os, x64] of [['windows', 'Journal-windows-x64-setup.exe'], ['linux', 'Journal-linux-amd64.AppImage']] as const) {
                const doc = load();
                const card = layoutDownloads(doc, os)!;
                expect(showArch(card, arch)).toBe(card);
                expect(button(card).href).toContain(x64);
                expect(featured(doc)).toEqual([card]);
            }
        });

        it('keeps the universal Mac build on ARM', () => {
            const doc = load();
            const card = layoutDownloads(doc, 'mac')!;
            expect(showArch(card, 'arm')).toBe(card);
            expect(button(card).href).toContain('Journal-darwin-universal.dmg');
        });
    });
});
