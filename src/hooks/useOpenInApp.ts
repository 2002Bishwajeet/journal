import { useEffect, useState } from 'react';
import { appDeepLink } from '@/lib/deepLink';
import { isNativeApp } from '@/lib/native';

/** How long the page may stay in view after the click before the app is assumed missing. */
const OPEN_IN_APP_TIMEOUT_MS = 1500;

/** Set in this browser once a click handed a link to the app; share pages then open it on load. */
export const OPENS_IN_APP_KEY = 'journal-opens-in-app';

/** Set after the first automatic launch, so a page load launches the app once at most. */
let autoLaunched = false;

/** Storage can throw (private mode, blocked cookies); then the flag is simply off. */
function readFlag(): boolean {
    try {
        return localStorage.getItem(OPENS_IN_APP_KEY) === '1';
    } catch {
        return false;
    }
}

function writeFlag(on: boolean) {
    try {
        if (on) localStorage.setItem(OPENS_IN_APP_KEY, '1');
        else localStorage.removeItem(OPENS_IN_APP_KEY);
    } catch {
        // Nothing to remember without storage.
    }
}

/** A desktop browser: not a phone or tablet UA (iPadOS reports as a Mac with a touch screen). */
function isDesktopBrowser(): boolean {
    if (typeof navigator === 'undefined') return false;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return false;
    return !(/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** The `journal://` link for `route` in a desktop browser; null on phones and in the app. */
function appHref(route: string): string | null {
    return !isNativeApp() && isDesktopBrowser() ? appDeepLink(route) : null;
}

/**
 * The "Open in app" action: the `journal://` link for `route`, shown in a desktop
 * browser only (`href` is null elsewhere). `onOpen` starts the wait: if the page loses focus
 * or visibility within `OPEN_IN_APP_TIMEOUT_MS` the app took the link and this browser is
 * remembered; otherwise `missing` turns true.
 */
export function useOpenInApp(route: string) {
    const [clicked, setClicked] = useState(false);
    const [missing, setMissing] = useState(false);
    const href = appHref(route);

    useEffect(() => {
        if (!clicked) return;
        const opened = () => {
            clearTimeout(timer);
            setClicked(false);
            writeFlag(true);
        };
        const timer = setTimeout(() => {
            setClicked(false);
            setMissing(true);
        }, OPEN_IN_APP_TIMEOUT_MS);
        window.addEventListener('blur', opened);
        document.addEventListener('visibilitychange', opened);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('blur', opened);
            document.removeEventListener('visibilitychange', opened);
        };
    }, [clicked]);

    return {
        href,
        missing,
        onOpen: () => {
            setMissing(false);
            setClicked(true);
        },
    };
}

/**
 * On a remembered desktop browser a share page launches the app once per page load and
 * `autoOpened` is true; `stayInBrowser` forgets the browser and turns `autoOpened` off.
 */
export function useAutoOpenInApp(route: string) {
    const href = appHref(route);
    // Only the share page itself: the save and open screens act on load in the browser too.
    const [autoOpened, setAutoOpened] = useState(
        () => href !== null && route.startsWith('/share/') && !autoLaunched && readFlag(),
    );

    useEffect(() => {
        if (!autoOpened || !href || autoLaunched) return;
        autoLaunched = true;
        Object.assign(document.createElement('a'), { href }).click();
    }, [autoOpened, href]);

    return {
        autoOpened,
        stayInBrowser: () => {
            writeFlag(false);
            setAutoOpened(false);
        },
    };
}
