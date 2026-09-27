/**
 * Security (SEC-07): /auth/finalize used to redirect to whatever the `state`
 * param contained, unvalidated — an open redirect (javascript: URIs, off-origin
 * hosts). sanitizeReturnUrl must reduce any unsafe target to '/' and pass through
 * only same-origin http(s) paths.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeReturnUrl } from '@/lib/utils';

const ORIGIN = 'https://journal.example';

describe('sanitizeReturnUrl', () => {
    it('rejects a javascript: URI', () => {
        expect(sanitizeReturnUrl('javascript:alert(1)', ORIGIN)).toBe('/');
    });

    it('rejects an off-origin absolute URL', () => {
        expect(sanitizeReturnUrl('https://evil.example', ORIGIN)).toBe('/');
        expect(sanitizeReturnUrl('https://evil.example/steal?t=1', ORIGIN)).toBe('/');
    });

    it('passes through a same-origin relative path', () => {
        expect(sanitizeReturnUrl('/folder/note?x=1', ORIGIN)).toBe('/folder/note?x=1');
    });

    it('reduces a same-origin absolute URL to its path/search/hash', () => {
        expect(
            sanitizeReturnUrl('https://journal.example/deep/path?a=1#frag', ORIGIN)
        ).toBe('/deep/path?a=1#frag');
    });

    it('falls back to / when URL construction throws', () => {
        // An absolute URL with a scheme but no host — new URL() throws.
        expect(sanitizeReturnUrl('https://', ORIGIN)).toBe('/');
    });

    it('rejects protocol-relative URLs pointing off-origin', () => {
        expect(sanitizeReturnUrl('//evil.example/path', ORIGIN)).toBe('/');
    });

    it('rejects same-origin paths that normalise to a protocol-relative URL', () => {
        // new URL() collapses these to the pathname "//evil.example", which
        // location.replace / navigate would resolve off-origin.
        expect(sanitizeReturnUrl('/.//evil.example', ORIGIN)).toBe('/');
        expect(sanitizeReturnUrl('/..//evil.example', ORIGIN)).toBe('/');
        expect(sanitizeReturnUrl('/./\\evil.example', ORIGIN)).toBe('/');
        expect(sanitizeReturnUrl('https://journal.example//evil.example', ORIGIN)).toBe('/');
    });
});
