import type { InvokeArgs } from '@tauri-apps/api/core';
import { deepLinkRoute } from '@/lib/deepLink';
import { hasNativePlugin, invokeNative, nativePlatform } from '@/lib/native';
import { registerReminderScheduler, type ReminderPermission, type ReminderScheduler } from '@/lib/native/reminders';

// macOS notifications (#1123): UserNotifications through the premium plugin
// (native/rust/mac_notify.rs), with "Open" and "Dismiss" actions, one group per note,
// and the daily reminder scheduled so it fires while Journal is closed.
const PLUGIN = 'journal-notifications';

/** Emitted by the plugin when the user opens a notification; `take_opened` hands over its link. */
const OPENED_EVENT = 'notification://opened';

/** True in the macOS app with the premium plugin; false on the web and in the public build. */
export function hasMacNotifications(): boolean {
    return nativePlatform() === 'macos' && hasNativePlugin(PLUGIN);
}

const call = <T>(command: string, args?: InvokeArgs) => invokeNative<T>(PLUGIN, command, args);

export const macReminderScheduler: ReminderScheduler = {
    permission: async () => (await call<ReminderPermission>('permission')) ?? 'denied',
    requestPermission: async () => (await call<ReminderPermission>('request_permission')) ?? 'denied',
    openSystemSettings: async () => {
        await call('open_settings');
    },
    replaceAll: async (reminders) => {
        await call('replace_reminders', { reminders });
    },
    cancelAll: async () => {
        await call('cancel_reminders');
    },
};

/** macOS app: makes the daily reminder available (Settings -> Notifications). */
export function registerMacReminderScheduler(): void {
    if (hasMacNotifications()) registerReminderScheduler(macReminderScheduler);
}

/**
 * Shows a notification in the `thread` group (one per note); "Open" goes to `route`.
 * Resolves false when the user hasn't allowed notifications.
 */
export async function notifyMac(title: string, body: string, route: string, thread: string): Promise<boolean> {
    return (await call<boolean>('notify', { title, body, url: route, thread })) ?? false;
}

/** The in-app route for an opened notification's link: a `journal://` link or an in-app path. */
export function notificationRoute(link: string): string | null {
    if (link.startsWith('journal:')) return deepLinkRoute(link);
    return link.startsWith('/') && !link.startsWith('//') ? link : null;
}

/**
 * Navigates to each notification the user opens, and to the one that launched the app.
 * Returns a function that stops listening. Does nothing outside the macOS app.
 */
export function routeOpenedNotifications(navigate: (route: string) => void): () => void {
    if (!hasMacNotifications()) return () => {};
    let stopped = false;
    let unlisten: (() => void) | undefined;

    const fail = (err: unknown) => console.error('[macNotifications] Failed to open a notification:', err);
    const take = () =>
        call<string | null>('take_opened')
            .then((link) => {
                const route = link ? notificationRoute(link) : null;
                if (route && !stopped) navigate(route);
            })
            .catch(fail);

    import('@tauri-apps/api/event')
        .then(async ({ listen }) => {
            const stop = await listen(OPENED_EVENT, take);
            if (stopped) return stop();
            unlisten = stop;
            await take();
        })
        .catch(fail);

    return () => {
        stopped = true;
        unlisten?.();
    };
}
