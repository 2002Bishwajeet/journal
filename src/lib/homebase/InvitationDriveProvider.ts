import {
    uploadFile,
    patchFile,
    deleteFile,
    getFileHeaderByUniqueId,
    type DotYouClient,
    type HomebaseFile,
    type UploadFileMetadata,
    type UploadInstructionSet,
    type UpdateInstructionSet,
    ScheduleOptions,
    PriorityOptions,
    SendContents,
} from '@homebase-id/js-lib/core';
import { deleteFileOverPeer } from '@homebase-id/js-lib/peer';
import { getRandom16ByteArray, toGuidId } from '@homebase-id/js-lib/helpers';
import {
    JOURNAL_DRIVE,
    COLLABORATION_INVITE_FILE_TYPE,
    COLLABORATION_INVITE_DATA_TYPE,
    COLLABORATIVE_FOLDER_ID,
} from './config';
import { sharedAcl } from './noteUploadMetadata';
import type { CollaborationInviteContent } from '@/types';

/**
 * InvitationDriveProvider handles collaboration invite files
 * (COLLABORATION_INVITE_FILE_TYPE), one per collaborative note.
 */
export class InvitationDriveProvider {
    #dotYouClient: DotYouClient;

    constructor(dotYouClient: DotYouClient) {
        this.#dotYouClient = dotYouClient;
    }

    async createOrUpdateInvitation(
        noteUniqueId: string,
        noteTitle: string,
        notePreview: string,
        share: { circleIds: string[]; odinIds: string[] },
        recipients: string[],
        authorOdinId: string,
    ): Promise<void> {
        const inviteUniqueId = toGuidId(`collab-invite-${noteUniqueId}`);
        const inviteContent: CollaborationInviteContent = {
            authorOdinId,
            noteUniqueId,
            noteTitle,
            notePreview: notePreview.slice(0, 150),
            sharedAt: new Date().toISOString(),
        };

        const existingInvite = await this.#findInvite(noteUniqueId);

        const uploadMetadata: UploadFileMetadata = {
            allowDistribution: true,
            appData: {
                fileType: COLLABORATION_INVITE_FILE_TYPE,
                dataType: COLLABORATION_INVITE_DATA_TYPE,
                uniqueId: inviteUniqueId,
                groupId: COLLABORATIVE_FOLDER_ID,
                content: JSON.stringify(inviteContent),
            },
            isEncrypted: true,
            accessControlList: sharedAcl(share),
        };

        if (existingInvite) {
            const updateInstructions: UpdateInstructionSet = {
                locale: 'local',
                file: { fileId: existingInvite.fileId, targetDrive: JOURNAL_DRIVE },
                versionTag: existingInvite.fileMetadata.versionTag,
                recipients,
            };

            await patchFile(
                this.#dotYouClient,
                existingInvite.sharedSecretEncryptedKeyHeader,
                updateInstructions,
                { versionTag: existingInvite.fileMetadata.versionTag, ...uploadMetadata },
            );
        } else {
            const instructionSet: UploadInstructionSet = {
                transferIv: getRandom16ByteArray(),
                storageOptions: { drive: JOURNAL_DRIVE },
                transitOptions: {
                    recipients,
                    schedule: ScheduleOptions.SendLater,
                    priority: PriorityOptions.High,
                    sendContents: SendContents.All,
                },
            };

            await uploadFile(
                this.#dotYouClient,
                instructionSet,
                uploadMetadata,
                [],
                [],
                true,
            );
        }
    }

    async deleteInvitation(noteUniqueId: string, recipients?: string[]): Promise<void> {
        const existingInvite = await this.#findInvite(noteUniqueId);
        if (existingInvite) {
            await deleteFile(this.#dotYouClient, JOURNAL_DRIVE, existingInvite.fileId, recipients);
        }
    }

    /**
     * Deletes the recipients' copies of the invite, for people taken off a share that
     * goes on (#681). The owner's invite stays for everyone still on it.
     */
    async withdrawInvitation(noteUniqueId: string, recipients: string[]): Promise<void> {
        const globalTransitId = (await this.#findInvite(noteUniqueId))?.fileMetadata.globalTransitId;
        if (globalTransitId) {
            await deleteFileOverPeer(this.#dotYouClient, JOURNAL_DRIVE, globalTransitId, recipients);
        }
    }

    async #findInvite(noteUniqueId: string): Promise<HomebaseFile<string> | null> {
        const invite = await getFileHeaderByUniqueId<string>(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            toGuidId(`collab-invite-${noteUniqueId}`),
            { decrypt: false }
        );
        return invite?.fileMetadata.appData.fileType === COLLABORATION_INVITE_FILE_TYPE ? invite : null;
    }
}
