import { toast } from 'sonner';
import { nativePlatform } from '@/lib/native';

const KEY = 'journal-desktop-notifications';

/** Desktop app only. On unless the user turned it off in Settings > Notifications. */
export function desktopNotificationsOn(): boolean {
    return localStorage.getItem(KEY) !== 'off';
}

export function setDesktopNotificationsOn(on: boolean): void {
    localStorage.setItem(KEY, on ? 'on' : 'off');
}

/**
 * Tells the user about an event the app received. In the desktop app, with the window
 * hidden or unfocused and the setting on, it is an OS notification; otherwise the
 * in-app toast. `route` is for the per-platform click-through issues (#1102, #1103,
 * #1123) and unused here.
 */
export async function notifyNative(title: string, body: string, route: string): Promise<void> {
    void route;
    const desktop = ['macos', 'windows', 'linux'].includes(nativePlatform() ?? '');
    if (desktop && desktopNotificationsOn() && (document.hidden || !document.hasFocus())) {
        try {
            const { notifyDesktop } = await import('@premium');
            if (await notifyDesktop(title, body)) return;
        } catch (err) {
            console.error('[notifyNative] OS notification failed:', err);
        }
    }
    toast(body ? `${title}: ${body}` : title);
}
