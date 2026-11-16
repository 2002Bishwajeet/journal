// @vitest-environment happy-dom
// #1282: the sign-in page opens on a welcome step on a device no identity signed in on; a
// device that signed in before (sign-out keeps the mark) goes straight to the identity form.
import { afterEach, describe, expect, it } from 'vitest';
import { hasSignedInBefore, markSignedIn, opensOnWelcome } from '@/lib/firstRun';

afterEach(() => localStorage.clear());

describe('first run vs returning', () => {
    it('should treat a clean profile as a first run', () => {
        expect(hasSignedInBefore()).toBe(false);
        expect(opensOnWelcome(hasSignedInBefore(), new URLSearchParams())).toBe(true);
    });

    it('should treat a device that signed in before as a return', () => {
        markSignedIn();
        expect(hasSignedInBefore()).toBe(true);
        expect(opensOnWelcome(hasSignedInBefore(), new URLSearchParams())).toBe(false);
    });

    it('should open on the form after a failed sign-in, to show its error', () => {
        expect(opensOnWelcome(false, new URLSearchParams('error=auth_failed'))).toBe(false);
    });

    it('should keep the welcome step for a first run sent to sign in from a link', () => {
        expect(opensOnWelcome(false, new URLSearchParams('returnUrl=%2Fnotes%2Fabc'))).toBe(true);
    });
});
