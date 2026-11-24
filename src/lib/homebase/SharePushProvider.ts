import {
    uploadFile,
    deleteFile,
    getFileHeaderByUniqueId,
    SecurityGroupType,
    type DotYouClient,
    type UploadFileMetadata,
    type UploadInstructionSet,
} from '@homebase-id/js-lib/core';
import { getRandom16ByteArray, toGuidId } from '@homebase-id/js-lib/helpers';
import {
    JOURNAL_APP_ID,
    JOURNAL_DRIVE,
    JOURNAL_PEER_SUBSCRIPTION_ID,
    JOURNAL_PUSH_TYPE_SHARE,
    JOURNAL_PUSH_TYPE_UNSHARE,
    SHARE_PUSH_FILE_TYPE,
} from './config';
import { appendLog } from '@/lib/diagnostics/logBuffer';
import {
    areShareNotificationsOff,
    isSubscriptionsRefusal,
    markShareNotificationsOff,
    SHARE_NOTIFICATIONS_OFF_MESSAGE,
} from './shareNotifications';

// No note title in either message: it passes through push services in the clear
const PUSHES = {
    share: { typeId: JOURNAL_PUSH_TYPE_SHARE, file: 'share-push', message: 'Shared a note with you' },
    unshare: { typeId: JOURNAL_PUSH_TYPE_UNSHARE, file: 'unshare-push', message: 'Stopped sharing a note with you' },
} as const;

/**
 * The owner's share push (#745) and unshare push (#1494). A local upload with only
 * notification options (no transit recipients) makes the owner's server send a standalone
 * peer push to each recipient that subscribed to the owner (#743). The outbox item points
 * at the uploaded file, so the file stays until the next push of the same kind for the note.
 */
export class SharePushProvider {
    #dotYouClient: DotYouClient;

    constructor(dotYouClient: DotYouClient) {
        this.#dotYouClient = dotYouClient;
    }

    /**
     * Pushes the people in `recipients` who were not in `previousRecipients` (shared), and
     * the people in `previousRecipients` who are not in `recipients` (unshared, so their app
     * drops the note). Never throws.
     */
    async send(noteId: string, recipients: string[], previousRecipients: string[] = []): Promise<void> {
        const host = this.#dotYouClient.getHostIdentity();
        const others = (ids: string[]) => [...new Set(ids)].filter((r) => r && r !== host);
        await this.#push('share', noteId, others(recipients).filter((r) => !previousRecipients.includes(r)));
        await this.#push('unshare', noteId, others(previousRecipients).filter((r) => !recipients.includes(r)));
    }

    async #push(kind: keyof typeof PUSHES, noteId: string, recipients: string[]): Promise<void> {
        const host = this.#dotYouClient.getHostIdentity();
        if (recipients.length === 0 || areShareNotificationsOff(host)) return;
        const { typeId, file, message } = PUSHES[kind];

        try {
            const uniqueId = toGuidId(`${file}-${noteId}`);
            const existing = await getFileHeaderByUniqueId(this.#dotYouClient, JOURNAL_DRIVE, uniqueId, { decrypt: false });
            if (existing) await deleteFile(this.#dotYouClient, JOURNAL_DRIVE, existing.fileId);

            const metadata: UploadFileMetadata = {
                allowDistribution: false,
                appData: { fileType: SHARE_PUSH_FILE_TYPE, uniqueId, content: JSON.stringify({ noteId }) },
                isEncrypted: false,
                accessControlList: { requiredSecurityGroup: SecurityGroupType.Owner },
            };
            const instructions: UploadInstructionSet = {
                transferIv: getRandom16ByteArray(),
                storageOptions: { drive: JOURNAL_DRIVE },
                transitOptions: {
                    useAppNotification: true,
                    appNotificationOptions: {
                        appId: JOURNAL_APP_ID,
                        typeId,
                        tagId: noteId,
                        silent: false,
                        unEncryptedMessage: message,
                        peerSubscriptionId: JOURNAL_PEER_SUBSCRIPTION_ID,
                        recipients,
                    },
                },
            };
            await uploadFile(this.#dotYouClient, instructions, metadata, [], [], false);
        } catch (error) {
            if (isSubscriptionsRefusal(error)) {
                markShareNotificationsOff(host);
                appendLog('warn', SHARE_NOTIFICATIONS_OFF_MESSAGE);
                return;
            }
            console.warn(`[SharePush] Could not send the ${kind} push:`, error);
        }
    }
}
