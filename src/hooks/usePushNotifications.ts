import { useEffect, useState } from 'react';
import { isAxiosError } from 'axios';
import { SendNotification } from '@homebase-id/js-lib/core';
import { useDotYouClientContext } from '@/components/auth';
import { JOURNAL_APP_ID, JOURNAL_TEST_PUSH_TYPE_ID } from '@/lib/homebase/config';
import { getNewId } from '@/lib/utils';
import { WebPushProvider, getPushSubscription } from '@/lib/homebase/WebPushProvider';

/** `ios-hint`: iOS Safari in a tab, where web push works only from the Home Screen app. */
export type PushStatus = 'unsupported' | 'ios-hint' | 'blocked' | 'on' | 'off';

/** The last "Send test": `forbidden` is a 403, the app lacks `SendPushNotifications`. */
export type TestPush =
    | { state: 'idle' | 'sending' | 'sent' | 'forbidden' }
    | { state: 'failed'; httpStatus?: number };

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
    const [testPush, setTestPush] = useState<TestPush>({ state: 'idle' });

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

    // The identity pushes to itself through the app push API, so every subscribed device gets it
    const sendTest = async () => {
        setTestPush({ state: 'sending' });
        try {
            await SendNotification(dotYouClient, {
                appId: JOURNAL_APP_ID,
                typeId: JOURNAL_TEST_PUSH_TYPE_ID,
                tagId: getNewId(),
                silent: false,
                unEncryptedMessage: 'Test notification from Journal',
            });
            setTestPush({ state: 'sent' });
        } catch (error) {
            console.warn('[Push] Test failed:', error);
            const httpStatus = isAxiosError(error) ? error.response?.status : undefined;
            setTestPush(httpStatus === 403 ? { state: 'forbidden' } : { state: 'failed', httpStatus });
        }
    };

    return { status, busy, failed, turnOn, turnOff, testPush, sendTest };
}
