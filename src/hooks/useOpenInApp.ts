import { useEffect, useState } from 'react';
import { appDeepLink } from '@/lib/deepLink';
import { isNativeApp } from '@/lib/native';

/** How long the page may stay in view after the click before the app is assumed missing. */
const OPEN_IN_APP_TIMEOUT_MS = 1500;

/** A desktop browser: not a phone or tablet UA (iPadOS reports as a Mac with a touch screen). */
function isDesktopBrowser(): boolean {
    if (typeof navigator === 'undefined') return false;
    if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return false;
    return !(/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/**
 * The "Open in Journal" action: the `journal://` link for `route`, shown in a desktop
 * browser only (`href` is null elsewhere). `onOpen` starts the wait; `missing` turns true when the page is still in
 * view after `OPEN_IN_APP_TIMEOUT_MS`, which means no app took the link.
 */
export function useOpenInApp(route: string) {
    const [clicked, setClicked] = useState(false);
    const [missing, setMissing] = useState(false);

    useEffect(() => {
        if (!clicked) return;
        const cancel = () => {
            clearTimeout(timer);
            setClicked(false);
        };
        const timer = setTimeout(() => {
            setClicked(false);
            setMissing(true);
        }, OPEN_IN_APP_TIMEOUT_MS);
        window.addEventListener('blur', cancel);
        document.addEventListener('visibilitychange', cancel);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('blur', cancel);
            document.removeEventListener('visibilitychange', cancel);
        };
    }, [clicked]);

    const href = !isNativeApp() && isDesktopBrowser() ? appDeepLink(route) : null;
    return {
        href,
        missing,
        onOpen: () => {
            setMissing(false);
            setClicked(true);
        },
    };
}
