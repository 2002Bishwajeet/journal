// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readJson, writeJson, readString, writeString, removeKey } from '@/lib/storage';

describe('storage helpers', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('readJson round-trips a value written with writeJson', () => {
        writeJson('k', { a: 1, b: ['x', 'y'] });
        expect(readJson('k')).toEqual({ a: 1, b: ['x', 'y'] });
    });

    it('readJson returns null when nothing is stored', () => {
        expect(readJson('missing')).toBeNull();
    });

    it('readJson returns null when localStorage.getItem throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(readJson('k')).toBeNull();
    });

    it('writeJson does not throw when localStorage.setItem throws', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(() => writeJson('k', { a: 1 })).not.toThrow();
    });

    it('readString round-trips a value written with writeString', () => {
        writeString('k', 'hello');
        expect(readString('k')).toBe('hello');
    });

    it('readString returns null when localStorage.getItem throws', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(readString('k')).toBeNull();
    });

    it('writeString does not throw when localStorage.setItem throws', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(() => writeString('k', 'hello')).not.toThrow();
    });

    it('removeKey removes a stored value', () => {
        writeString('k', 'hello');
        removeKey('k');
        expect(readString('k')).toBeNull();
    });

    it('removeKey does not throw when localStorage.removeItem throws', () => {
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('blocked');
        });
        expect(() => removeKey('k')).not.toThrow();
    });
});
