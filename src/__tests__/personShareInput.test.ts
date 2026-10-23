import { describe, it, expect } from 'vitest';
import { supportsNamedIdentities } from '@/lib/homebase/serverVersion';
import { isOdinId, normalizeOdinId } from '@/lib/homebase/shareTargets';

// #681 decision 8: a server without odin-core #1993 stores odinIdList, then refuses every reader
describe('supportsNamedIdentities', () => {
    it('is false for a release older than the first one with #1993', () => {
        expect(supportsNamedIdentities('v0.1.965')).toBe(false);
        expect(supportsNamedIdentities('0.0.999')).toBe(false);
    });

    it('is true from that release on', () => {
        expect(supportsNamedIdentities('v0.1.966')).toBe(true);
        expect(supportsNamedIdentities('"0.1.1000"')).toBe(true);
        expect(supportsNamedIdentities('v0.2.0')).toBe(true);
        expect(supportsNamedIdentities('1.0.0')).toBe(true);
    });

    it('is true for a branch build, which reports no release number', () => {
        expect(supportsNamedIdentities('-.-.-')).toBe(true);
        expect(supportsNamedIdentities('')).toBe(true);
    });
});

describe('typed identities', () => {
    it('are stored without scheme, path or capitals', () => {
        expect(normalizeOdinId('  https://Sam.DotYou.Cloud/owner ')).toBe('sam.dotyou.cloud');
    });

    it('must be domain names', () => {
        expect(isOdinId('sam.dotyou.cloud')).toBe(true);
        expect(isOdinId('sam')).toBe(false);
        expect(isOdinId('sam@dotyou.cloud')).toBe(false);
        expect(isOdinId('')).toBe(false);
    });
});
