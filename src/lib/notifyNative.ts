import { toast } from 'sonner';
import { nativePlatform } from '@/lib/native';
import { hasMacNotifications, notifyMac } from '@/lib/native/macNotifications';

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
 * in-app toast. On macOS the notification is grouped by `group` (a note id) and its
 * "Open" goes to `route` (#1123); the other platforms' click-through is #1102 and #1103.
 */
export async function notifyNative(title: string, body: string, route: string, group: string = route): Promise<void> {
    const desktop = ['macos', 'windows', 'linux'].includes(nativePlatform() ?? '');
    if (desktop && desktopNotificationsOn() && (document.hidden || !document.hasFocus())) {
        try {
            if (hasMacNotifications()) {
                if (await notifyMac(title, body, route, group)) return;
            } else {
                const { notifyDesktop } = await import('@premium');
                if (await notifyDesktop(title, body)) return;
            }
        } catch (err) {
            console.error('[notifyNative] OS notification failed:', err);
        }
    }
    toast(body ? `${title}: ${body}` : title);
}
