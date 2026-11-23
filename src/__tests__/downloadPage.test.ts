// @vitest-environment happy-dom
/**
 * #1475: the download page shows the visitor's OS as the one download, the other two under "Other platforms".
 * The CPU logic, which card is shown and which are collapsed, and the built page without script.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyArchNote, archNote, cpuArch, desktopOS, layoutDownloads } from '../../site/src/downloads';
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
});

describe('archNote', () => {
    it('needs no check on a Mac, whose build is universal', () => {
        expect(archNote('mac', 'x64')).toBeNull();
        expect(archNote('mac', 'arm')).toBeNull();
        expect(archNote('mac', null)).toBeNull();
    });

    it('has no note for Windows or Linux on x64 or an unknown CPU', () => {
        for (const os of ['windows', 'linux'] as const) {
            expect(archNote(os, 'x64')).toBeNull();
            expect(archNote(os, null)).toBeNull();
        }
    });

    it('offers the x64 installer on Windows on ARM, with a note about emulation', () => {
        const note = archNote('windows', 'arm');
        expect(note?.text).toMatch(/x64 emulation/);
        expect(note?.noBuild).toBeUndefined();
    });

    it('says there is no ARM build on Linux on ARM', () => {
        expect(archNote('linux', 'arm')).toMatchObject({ noBuild: true, text: expect.stringMatching(/no ARM build/) });
    });
});

describe('the built download page without script', () => {
    const source = readFileSync(resolve(process.cwd(), 'site/download.html'), 'utf8');
    const html = render(source, { billing: true, downloads: true, renew: false, appstore: false, play: false });

    it('still lists all three platforms, with nothing collapsed', () => {
        expect([...html.matchAll(/<li class="dl-item" data-os="(\w+)">/g)].map(([, os]) => os)).toEqual(['mac', 'windows', 'linux']);
        expect(html).not.toContain('Other platforms');
        expect(html).toContain('Journal-darwin-universal.dmg');
        expect(html).toContain('Journal-windows-x64-setup.exe');
        expect(html).toContain('Journal-linux-amd64.AppImage');
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

    it.each(['mac', 'windows', 'linux'] as const)('shows %s and collapses the other two', (os) => {
        const doc = load();
        const shown = layoutDownloads(doc, desktopOS(agents[os]));
        expect(shown?.dataset.os).toBe(os);
        expect(shown?.querySelector('.btn')?.classList.contains('btn-primary')).toBe(true);
        const collapsed = [...doc.querySelectorAll('details.dl-other .dl-item')].map((li) => (li as HTMLElement).dataset.os);
        expect(collapsed).toHaveLength(2);
        expect(collapsed).not.toContain(os);
        expect([...doc.querySelectorAll('.dl-item')].filter((li) => !li.closest('.dl-other'))).toHaveLength(1);
    });

    it.each([
        ['a phone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1'],
        ['Android', 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36'],
        ['an unknown agent', 'curl/8.0'],
    ])('leaves all three listed for %s', (_, ua) => {
        const doc = load();
        expect(layoutDownloads(doc, desktopOS(ua))).toBeNull();
        expect([...doc.querySelectorAll('.dl-item')].filter((li) => !li.closest('.dl-other'))).toHaveLength(3);
        expect(doc.querySelector('details.dl-other')).toBeNull();
    });

    it('adds an emulation note on Windows on ARM and keeps the installer', () => {
        const doc = load();
        const shown = layoutDownloads(doc, 'windows')!;
        applyArchNote(shown, 'windows', 'arm');
        expect(shown.textContent).toMatch(/x64 emulation/);
        expect(shown.querySelector<HTMLAnchorElement>('.btn')?.href).toContain('Journal-windows-x64-setup.exe');
    });

    it('replaces the x64 text and the .deb link on Linux on ARM', () => {
        const doc = load();
        const shown = layoutDownloads(doc, 'linux')!;
        applyArchNote(shown, 'linux', 'arm');
        expect(shown.textContent).toMatch(/no ARM build/);
        expect(shown.textContent).not.toMatch(/x64|\.deb/);
        expect(shown.querySelector('.btn')?.textContent).toBe('Open Journal in the browser');
        expect(shown.querySelector('a[href$=".deb"]')).toBeNull();
    });
});
