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

    it('matches the author index and a shared folder page (#619)', () => {
        expect(isPublicSharePath('/share/bishwajeetparhi.dev')).toBe(true);
        expect(isPublicSharePath('/share/bishwajeetparhi.dev/f/e5b899be-0000-4000-8000-000000000000')).toBe(true);
    });

    it('does not match the authenticated share-target route', () => {
        expect(isPublicSharePath('/app/share-target')).toBe(false);
    });

    it('does not match other app routes', () => {
        expect(isPublicSharePath('/app/')).toBe(false);
        expect(isPublicSharePath('/app/inbox')).toBe(false);
        expect(isPublicSharePath('/app/inbox/note-1')).toBe(false);
        expect(isPublicSharePath('/app/welcome')).toBe(false);
        expect(isPublicSharePath('/app/auth/finalize')).toBe(false);
        expect(isPublicSharePath('/app/mcp/code')).toBe(true);
    });
});
