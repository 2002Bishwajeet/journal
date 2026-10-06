// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { STORAGE_KEY_SHARED_SECRET } from '@/lib/homebase/config';

const { getDatabase } = vi.hoisted(() => ({ getDatabase: vi.fn(() => Promise.resolve({})) }));
vi.mock('@/lib/db/pglite', () => ({ getDatabase }));

import { hasStoredLogin, shouldPrewarmDatabase, prewarmDatabase } from '@/lib/dbPrewarm';

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('database prewarm gate', () => {
    beforeEach(() => {
        localStorage.clear();
        getDatabase.mockClear();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('prewarms for a stored login on an app path', async () => {
        localStorage.setItem(STORAGE_KEY_SHARED_SECRET, 'secret');
        expect(shouldPrewarmDatabase('/')).toBe(true);
        prewarmDatabase('/');
        await vi.waitFor(() => expect(getDatabase).toHaveBeenCalledTimes(1));
    });

    it('does not prewarm on a public share page, even with a stored login', async () => {
        localStorage.setItem(STORAGE_KEY_SHARED_SECRET, 'secret');
        expect(shouldPrewarmDatabase('/share/me.example/abc')).toBe(false);
        prewarmDatabase('/share/me.example/abc');
        await settle();
        expect(getDatabase).not.toHaveBeenCalled();
    });

    it('does not prewarm for a visitor with no stored login', async () => {
        expect(shouldPrewarmDatabase('/')).toBe(false);
        prewarmDatabase('/');
        await settle();
        expect(getDatabase).not.toHaveBeenCalled();
    });

    it('does not prewarm, and does not throw, when storage throws', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        expect(hasStoredLogin()).toBe(false);
        expect(() => prewarmDatabase('/')).not.toThrow();
        await settle();
        expect(getDatabase).not.toHaveBeenCalled();
    });

    it('swallows a boot rejection (the query path reports it)', async () => {
        localStorage.setItem(STORAGE_KEY_SHARED_SECRET, 'secret');
        getDatabase.mockImplementationOnce(() => Promise.reject(new Error('boot failed')));
        prewarmDatabase('/');
        await vi.waitFor(() => expect(getDatabase).toHaveBeenCalledTimes(1));
        await settle();
    });
});
