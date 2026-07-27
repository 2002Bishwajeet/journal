import { describe, it, expect } from 'vitest';
import { isPublicSharePath } from '@/lib/utils';

// This predicate gates the PGlite warm-start, persistent-storage request and
// service-worker registration (main.tsx, App.tsx). A false positive would boot
// an authenticated app route without its database.
describe('isPublicSharePath', () => {
    it('matches a public share note', () => {
        expect(isPublicSharePath('/share/bishwajeetparhi.dev/e5b899be')).toBe(true);
    });

    it('does not match /share-target — that is an authenticated app route', () => {
        expect(isPublicSharePath('/share-target')).toBe(false);
    });

    it('does not match ordinary app routes', () => {
        for (const path of ['/', '/inbox', '/inbox/note-1', '/welcome', '/auth/finalize']) {
            expect(isPublicSharePath(path)).toBe(false);
        }
    });
});
