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
    SHARE_PUSH_FILE_TYPE,
} from './config';

/**
 * The owner's share push (#745). A local upload with only notification options (no
 * transit recipients) makes the owner's server send a standalone peer push to each
 * recipient that subscribed to the owner (#743). The outbox item points at the
 * uploaded file, so the file stays until the next share of the same note.
 */
export class SharePushProvider {
    #dotYouClient: DotYouClient;

    constructor(dotYouClient: DotYouClient) {
        this.#dotYouClient = dotYouClient;
    }

    /** Pushes the people in `recipients` who were not in `previousRecipients`. Never throws. */
    async send(noteId: string, recipients: string[], previousRecipients: string[] = []): Promise<void> {
        const host = this.#dotYouClient.getHostIdentity();
        const newRecipients = recipients.filter((r) => r && r !== host && !previousRecipients.includes(r));
        if (newRecipients.length === 0) return;

        try {
            const uniqueId = toGuidId(`share-push-${noteId}`);
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
                    // No note title: the message passes through push services in the clear
                    appNotificationOptions: {
                        appId: JOURNAL_APP_ID,
                        typeId: JOURNAL_PUSH_TYPE_SHARE,
                        tagId: noteId,
                        silent: false,
                        unEncryptedMessage: 'Shared a note with you',
                        peerSubscriptionId: JOURNAL_PEER_SUBSCRIPTION_ID,
                        recipients: newRecipients,
                    },
                },
            };
            await uploadFile(this.#dotYouClient, instructions, metadata, [], [], false);
        } catch (error) {
            console.warn('[SharePush] Could not send the share push:', error);
        }
    }
}
