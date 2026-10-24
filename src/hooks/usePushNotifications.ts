import { useEffect, useState } from 'react';
import { useDotYouClientContext } from '@/components/auth';
import { WebPushProvider, getPushSubscription } from '@/lib/homebase/WebPushProvider';

/** `ios-hint`: iOS Safari in a tab, where web push works only from the Home Screen app. */
export type PushStatus = 'unsupported' | 'ios-hint' | 'blocked' | 'on' | 'off';

function getSupport(): 'supported' | 'ios-hint' | 'unsupported' {
    if ('PushManager' in window && 'serviceWorker' in navigator && 'Notification' in window) return 'supported';
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && (navigator as { standalone?: boolean }).standalone !== true) return 'ios-hint';
    return 'unsupported';
}

/**
 * Opt-in to Journal web pushes on this device (#744). Never asks for permission on its own:
 * `turnOn` is meant to run from a click.
 */
export function usePushNotifications() {
    const dotYouClient = useDotYouClientContext();
    const support = getSupport();
    const [permission, setPermission] = useState<NotificationPermission>(() =>
        support === 'supported' ? Notification.permission : 'default'
    );
    const [subscribed, setSubscribed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (support !== 'supported') return;
        let cancelled = false;
        getPushSubscription()
            .then((subscription) => {
                if (!cancelled) setSubscribed(!!subscription);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [support]);

    let status: PushStatus;
    if (support !== 'supported') status = support;
    else if (permission === 'denied') status = 'blocked';
    else status = subscribed && permission === 'granted' ? 'on' : 'off';

    const run = async (task: () => Promise<void>) => {
        setBusy(true);
        setFailed(false);
        try {
            await task();
        } catch (error) {
            console.warn('[Push] Failed:', error);
            setFailed(true);
        } finally {
            setBusy(false);
        }
    };

    const turnOn = () =>
        run(async () => {
            const result = await Notification.requestPermission();
            setPermission(result);
            if (result !== 'granted') return;
            const provider = new WebPushProvider(dotYouClient);
            const applicationServerKey = await provider.getPublicKey();
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
            try {
                await provider.subscribe(subscription);
            } catch (error) {
                await subscription.unsubscribe().catch(() => {});
                throw error;
            }
            setSubscribed(true);
        });

    const turnOff = () =>
        run(async () => {
            const subscription = await getPushSubscription();
            await new WebPushProvider(dotYouClient).unsubscribe();
            await subscription?.unsubscribe();
            setSubscribed(false);
        });

    return { status, busy, failed, turnOn, turnOff };
}
