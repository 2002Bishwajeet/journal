import { getBrowser } from '@homebase-id/js-lib/auth';
import { ApiType, DotYouClient } from '@homebase-id/js-lib/core';

const PATH = '/notify/push';

/**
 * This device's web push subscription with the identity (odin-core `/notify/push`), for the
 * app token. Needs the `SendPushNotifications` app permission.
 */
export class WebPushProvider {
    #dotYouClient: DotYouClient;

    constructor(dotYouClient: DotYouClient) {
        this.#dotYouClient = dotYouClient;
    }

    /** The identity's VAPID public key, the `applicationServerKey` for `pushManager.subscribe`. */
    async getPublicKey(): Promise<string> {
        const guest = new DotYouClient({ hostIdentity: this.#dotYouClient.getHostIdentity(), api: ApiType.Guest });
        const response = await guest.createAxiosClient().get<string>('/public/keys/notifications_pk');
        return response.data;
    }

    async subscribe(subscription: PushSubscription): Promise<void> {
        const { keys } = subscription.toJSON();
        if (!keys) throw new Error('Push subscription has no keys');
        await this.#dotYouClient.createAxiosClient().post(`${PATH}/subscribe`, {
            endpoint: subscription.endpoint,
            auth: keys.auth,
            p256dh: keys.p256dh,
            friendlyName: `Journal PWA ${getBrowser() ?? ''}`.trim(),
        });
    }

    async unsubscribe(): Promise<void> {
        await this.#dotYouClient.createAxiosClient().post(`${PATH}/unsubscribe`);
    }
}

/** The service worker's current push subscription, if any. */
export async function getPushSubscription(): Promise<PushSubscription | null> {
    if (!('serviceWorker' in navigator)) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager?.getSubscription()) ?? null;
}

/** Drop this device's subscription on the identity and in the browser. Errors are ignored (logout). */
export async function removeWebPush(dotYouClient: DotYouClient): Promise<void> {
    try {
        const subscription = await getPushSubscription();
        if (!subscription) return;
        await new WebPushProvider(dotYouClient).unsubscribe().catch(() => {});
        await subscription.unsubscribe();
    } catch {
        // Ignore: logout goes on
    }
}
