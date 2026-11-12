import { PUBLIC_ORIGIN } from '@/lib/native';

/** The app's URL scheme (tauri.conf.json, plugins.deep-link). */
const SCHEME = 'journal:';

/**
 * The in-app route for a link that opened the native app, or null when the app has
 * no screen for it. Takes `https://journal.cloudx.run/<path>` (iOS Universal Links,
 * Android App Links) and `journal://<path>` (desktop). Opens a note's share page and
 * the save/open-shared screens; the author index, folder pages and sitemaps are
 * Pages Function HTML with no in-app screen. `journal://auth/finalize` is the
 * YouAuth callback of the native sign-in (`startSignIn` in native.ts); it has no
 * https form, so a web link can't stand in for it. `journal://today` opens today's note.
 */
export function deepLinkRoute(link: string): string | null {
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return null;
    }
    // journal://share/a/b parses with host "share" and path "/a/b".
    let path: string;
    if (url.protocol === SCHEME) path = `/${url.host}${url.pathname}`.replace(/^\/+/, '/');
    else if (url.origin === PUBLIC_ORIGIN) path = url.pathname;
    else return null;

    const parts = path.split('/').filter(Boolean);
    const isNotePage = parts.length === 3 && parts[0] === 'share' && parts[2] !== 'sitemap.xml';
    const isSharedScreen = parts.length === 1 && (parts[0] === 'save-shared' || parts[0] === 'open-shared');
    const isAuthCallback = url.protocol === SCHEME && parts.join('/') === 'auth/finalize';
    // The daily reminder's link (REMINDER_URL in reminderSchedule.ts): today's note.
    const isToday = url.protocol === SCHEME && parts.join('/') === 'today';
    if (!isNotePage && !isSharedScreen && !isAuthCallback && !isToday) return null;
    return `/${parts.join('/')}${url.search}${url.hash}`;
}
