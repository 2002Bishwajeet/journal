/**
 * A public /share/:identity/:noteId page must not pay for app-only boot work
 * (#155). isPublicSharePath is the single guard used by main.tsx and App.tsx
 * to detect it; /share-target (authenticated) must not match.
 */
import { describe, it, expect } from 'vitest';
import { isPublicSharePath } from '@/lib/sharePath';

describe('isPublicSharePath', () => {
    it('matches a public share link', () => {
        expect(isPublicSharePath('/share/bishwajeetparhi.dev/e5b899be')).toBe(true);
    });

    it('does not match the authenticated share-target route', () => {
        expect(isPublicSharePath('/share-target')).toBe(false);
    });

    it('does not match other app routes', () => {
        expect(isPublicSharePath('/')).toBe(false);
        expect(isPublicSharePath('/inbox')).toBe(false);
        expect(isPublicSharePath('/inbox/note-1')).toBe(false);
        expect(isPublicSharePath('/welcome')).toBe(false);
        expect(isPublicSharePath('/auth/finalize')).toBe(false);
    });
});
