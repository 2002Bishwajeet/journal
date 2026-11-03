/**
 * #671: the app's Report-Only Content-Security-Policy lives in site/public/_headers (vite.config.ts
 * reads it from there). An html live block's frame inherits it, so the CDN hosts it allows
 * must be exactly the ones a block may load from: adding a host to blocks fails here until
 * the app policy follows. Only frame-src is enforced (#945): a live block must not be able to
 * navigate its frame off the app.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HTML_BLOCK_CDN_HOSTS } from '@/lib/liveBlocks';

const HEADERS = readFileSync(new URL('../../site/public/_headers', import.meta.url), 'utf8');
const policy = HEADERS.match(/^\s+Content-Security-Policy-Report-Only: (.+)$/m)?.[1] ?? '';
const directive = (name: string) =>
    policy.split(';').map((part) => part.trim().split(/\s+/)).find(([key]) => key === name)?.slice(1) ?? [];

describe('app Content-Security-Policy', () => {
    it('should be Report-Only, but for an enforced frame-src', () => {
        expect(policy).toContain("default-src 'self'");
        expect(HEADERS.match(/^\s+Content-Security-Policy: (.+)$/m)?.[1]).toBe("frame-src 'self'");
    });

    it.each(['script-src', 'style-src', 'font-src'])('should allow exactly the html block CDN hosts in %s', (name) => {
        expect(directive(name).filter((source) => source.startsWith('https://'))).toEqual(HTML_BLOCK_CDN_HOSTS);
    });
});
