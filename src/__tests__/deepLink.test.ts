import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deepLinkRoute } from '@/lib/deepLink';

const NOTE = '0b9b5e3c-3f1e-4b8a-9a35-1d1f3f6c2a10';

describe('deepLinkRoute', () => {
    it.each([
        [`https://journal.cloudx.run/share/alice.dotyou.cloud/${NOTE}`, `/share/alice.dotyou.cloud/${NOTE}`],
        [`https://journal.cloudx.run/share/alice.dotyou.cloud/${NOTE}/`, `/share/alice.dotyou.cloud/${NOTE}`],
        [`https://journal.cloudx.run/share/alice.dotyou.cloud/${NOTE}#intro`, `/share/alice.dotyou.cloud/${NOTE}#intro`],
        [`https://journal.cloudx.run/save-shared?identity=alice.dotyou.cloud&file=${NOTE}`, `/save-shared?identity=alice.dotyou.cloud&file=${NOTE}`],
        [`https://journal.cloudx.run/open-shared?identity=alice.dotyou.cloud&file=${NOTE}`, `/open-shared?identity=alice.dotyou.cloud&file=${NOTE}`],
        [`journal://share/alice.dotyou.cloud/${NOTE}`, `/share/alice.dotyou.cloud/${NOTE}`],
        [`journal:///share/alice.dotyou.cloud/${NOTE}`, `/share/alice.dotyou.cloud/${NOTE}`],
        [`journal://save-shared?identity=alice.dotyou.cloud&file=${NOTE}`, `/save-shared?identity=alice.dotyou.cloud&file=${NOTE}`],
    ])('opens %s at %s', (link, route) => {
        expect(deepLinkRoute(link)).toBe(route);
    });

    it.each([
        ['the author index', 'https://journal.cloudx.run/share/alice.dotyou.cloud'],
        ['a folder page', `https://journal.cloudx.run/share/alice.dotyou.cloud/f/${NOTE}`],
        ['a sitemap', 'https://journal.cloudx.run/share/alice.dotyou.cloud/sitemap.xml'],
        ['the landing pages', 'https://journal.cloudx.run/landing/agents'],
        ['the auth callback', 'https://journal.cloudx.run/auth/finalize?code=1'],
        ['the home page', 'https://journal.cloudx.run/'],
        ['another host', `https://evil.example/share/alice.dotyou.cloud/${NOTE}`],
        ['a lookalike host', `https://journal.cloudx.run.evil.example/share/alice.dotyou.cloud/${NOTE}`],
        ['plain http', `http://journal.cloudx.run/share/alice.dotyou.cloud/${NOTE}`],
        ['another scheme', `other://share/alice.dotyou.cloud/${NOTE}`],
        ['not a URL', 'share/alice/123'],
    ])('has no screen for %s', (_, link) => {
        expect(deepLinkRoute(link)).toBeNull();
    });
});

describe('app link files', () => {
    const read = (path: string) => readFileSync(new URL(`../../public/${path}`, import.meta.url), 'utf8');

    it('lets the iOS app open note share pages but not folder pages or sitemaps', () => {
        const aasa = JSON.parse(read('.well-known/apple-app-site-association'));
        const [details] = aasa.applinks.details;
        expect(details.appIDs).toEqual(['N899Y9TW48.com.biswa.journal']);
        const paths = details.components.map((c: { '/': string; exclude?: boolean }) => (c.exclude ? `!${c['/']}` : c['/']));
        // Exclusions must come first: iOS takes the first component that matches.
        expect(paths).toEqual(['!/share/*/f/*', '!/share/*/sitemap.xml', '/share/*/*', '/save-shared', '/open-shared']);
    });

    it('lets the Android app verify journal.cloudx.run with its upload key', () => {
        const [statement] = JSON.parse(read('.well-known/assetlinks.json'));
        expect(statement.target.package_name).toBe('com.biswa.journal');
        expect(statement.target.sha256_cert_fingerprints).toContain(
            '0F:9C:49:2A:EE:62:12:22:87:8D:5A:D0:ED:2F:83:33:F8:D9:B7:8C:D0:3B:7D:DE:6B:A8:1D:72:BE:A1:BF:BB',
        );
    });

    it('serves both files as JSON', () => {
        const headers = read('_headers');
        for (const file of ['apple-app-site-association', 'assetlinks.json']) {
            expect(headers).toMatch(new RegExp(`^/\\.well-known/${file.replace('.', '\\.')}\\n  Content-Type: application/json$`, 'm'));
        }
    });
});
