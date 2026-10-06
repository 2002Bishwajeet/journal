import { STORAGE_KEY_SHARED_SECRET } from '@/lib/homebase/config';
import { isPublicSharePath } from '@/lib/sharePath';

/** A login is stored on this device (an expired token still counts). Never throws. */
export function hasStoredLogin(): boolean {
    try {
        return !!localStorage.getItem(STORAGE_KEY_SHARED_SECRET);
    } catch {
        return false;
    }
}

/** Only a returning, logged-in app visit needs the DB; share pages and visitors never do. */
export function shouldPrewarmDatabase(pathname: string): boolean {
    return !isPublicSharePath(pathname) && hasStoredLogin();
}

/**
 * Start booting PGlite while React mounts and auth resolves. getDatabase() is a
 * cached singleton, so the real query path later awaits this same boot. Errors
 * are ignored here: that path reports them.
 */
export function prewarmDatabase(pathname: string): void {
    if (!shouldPrewarmDatabase(pathname)) return;
    void import('./db/pglite').then((m) => m.getDatabase()).catch(() => {});
}
