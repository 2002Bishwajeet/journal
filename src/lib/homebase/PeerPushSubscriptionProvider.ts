import type { DotYouClient } from '@homebase-id/js-lib/core';
import { JOURNAL_PEER_SUBSCRIPTION_ID } from './config';

const PATH = '/notify/peer/subscriptions/push-notification';

export interface PeerPushSubscription {
    identity: string;
    subscriptionId: string;
}

/**
 * Subscriptions to a connection's peer push (odin-core `/notify/peer`). The server accepts a
 * standalone push from a connection only if the recipient subscribed to it with the same id.
 * Needs the `SendPushNotifications` app permission.
 */
export class PeerPushSubscriptionProvider {
    #dotYouClient: DotYouClient;

    constructor(dotYouClient: DotYouClient) {
        this.#dotYouClient = dotYouClient;
    }

    #client() {
        return this.#dotYouClient.createAxiosClient();
    }

    async list(): Promise<PeerPushSubscription[]> {
        const response = await this.#client().get<PeerPushSubscription[]>(PATH);
        return response.data ?? [];
    }

    /** Upsert, so a repeat call is safe. */
    async subscribe(odinId: string): Promise<void> {
        await this.#client().post(PATH, { identity: odinId, subscriptionId: JOURNAL_PEER_SUBSCRIPTION_ID });
    }

    async unsubscribe(odinId: string): Promise<void> {
        await this.#client().delete(PATH, { data: { identity: odinId, subscriptionId: JOURNAL_PEER_SUBSCRIPTION_ID } });
    }
}
