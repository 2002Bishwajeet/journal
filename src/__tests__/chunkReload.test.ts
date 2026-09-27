// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isChunkLoadError, reloadOnceForChunkError } from '@/lib/utils/chunkReload';

describe('isChunkLoadError', () => {
    it.each([
        ['Chromium', 'Failed to fetch dynamically imported module: https://x/y.js'],
        ['Firefox', 'error loading dynamically imported module'],
        ['Safari', 'Importing a module script failed'],
        ['MIME error', "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\". Strict MIME type checking is enforced."],
        ['MIME error variant', 'is not a valid JavaScript MIME type'],
        ['legacy webpack loading', 'Loading chunk 4 failed.\n(missing: https://x/4.js)'],
        ['legacy webpack ChunkLoadError', 'ChunkLoadError: Loading chunk failed'],
        ['case-insensitive', 'FAILED TO FETCH DYNAMICALLY IMPORTED MODULE'],
    ])('matches %s message', (_label, message) => {
        expect(isChunkLoadError(new Error(message))).toBe(true);
    });

    it('matches a plain string, not just an Error object', () => {
        expect(isChunkLoadError('Importing a module script failed')).toBe(true);
    });

    it('returns false for an unrelated error', () => {
        expect(isChunkLoadError(new Error('Cannot read properties of null'))).toBe(false);
    });

    it('returns false for non-error, non-string values', () => {
        expect(isChunkLoadError(undefined)).toBe(false);
        expect(isChunkLoadError(null)).toBe(false);
        expect(isChunkLoadError(42)).toBe(false);
    });
});

describe('reloadOnceForChunkError', () => {
    let now = 1_000_000;
    let reloadSpy: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        sessionStorage.clear();
        now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => now);
        reloadSpy = vi.fn<() => void>();
        vi.spyOn(window.location, 'reload').mockImplementation(reloadSpy);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reloads once and returns true', () => {
        expect(reloadOnceForChunkError()).toBe(true);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('suppresses a second call within 10 seconds', () => {
        expect(reloadOnceForChunkError()).toBe(true);
        now += 5_000;
        expect(reloadOnceForChunkError()).toBe(false);
        expect(reloadSpy).toHaveBeenCalledTimes(1);
    });

    it('allows a reload again after 10 seconds', () => {
        expect(reloadOnceForChunkError()).toBe(true);
        now += 10_000;
        expect(reloadOnceForChunkError()).toBe(true);
        expect(reloadSpy).toHaveBeenCalledTimes(2);
    });

    it('returns false when storage access throws (private mode)', () => {
        vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError');
        });
        expect(reloadOnceForChunkError()).toBe(false);
        expect(reloadSpy).not.toHaveBeenCalled();
    });
});
