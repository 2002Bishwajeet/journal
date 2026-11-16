import { readString, SIGNED_IN_BEFORE_KEY, writeString } from '@/lib/storage';

/** Remembers that an identity signed in on this device. Called on every signed-in boot. */
export function markSignedIn(): void {
    writeString(SIGNED_IN_BEFORE_KEY, '1');
}

/** Whether an identity signed in on this device before (sign-out keeps the answer). */
export function hasSignedInBefore(): boolean {
    return readString(SIGNED_IN_BEFORE_KEY) !== null;
}

/**
 * Whether the sign-in page opens on its welcome step (#1282): only on a device no identity
 * signed in on, and not when a sign-in just failed (the form shows the error).
 */
export function opensOnWelcome(signedInBefore: boolean, search: URLSearchParams): boolean {
    return !signedInBefore && !search.has('error');
}
