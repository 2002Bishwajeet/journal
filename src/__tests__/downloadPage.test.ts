/**
 * #1475: the download page shows the visitor's OS as the one download, the other two under "Other platforms".
 * The CPU logic, which card is shown and which are collapsed, and the built page without script.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { archNote, cpuArch } from '../../site/src/downloads';
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
    const source = readFileSync(new URL('../../site/download.html', import.meta.url), 'utf8');
    const html = render(source, { billing: true, downloads: true, renew: false, appstore: false, play: false });

    it('still lists all three platforms, with nothing collapsed', () => {
        expect([...html.matchAll(/<li class="dl-item" data-os="(\w+)">/g)].map(([, os]) => os)).toEqual(['mac', 'windows', 'linux']);
        expect(html).not.toContain('Other platforms');
        expect(html).toContain('Journal-darwin-universal.dmg');
        expect(html).toContain('Journal-windows-x64-setup.exe');
        expect(html).toContain('Journal-linux-amd64.AppImage');
    });
});
