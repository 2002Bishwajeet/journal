import { useEffect } from 'react';
import { OTHER_APPS_NOTIFICATION_TAG } from '@/lib/homebase/config';

/** Close the service worker's quiet "other Homebase apps" notification when Journal opens or gains focus. */
export function useCloseOtherAppNotifications() {
    useEffect(() => {
        const close = async () => {
            const registration = await navigator.serviceWorker?.getRegistration();
            const notifications = (await registration?.getNotifications({ tag: OTHER_APPS_NOTIFICATION_TAG })) ?? [];
            for (const n of notifications) n.close();
        };
        void close();
        window.addEventListener('focus', close);
        return () => window.removeEventListener('focus', close);
    }, []);
}
