import {
    uploadFile,
    patchFile,
    deleteFile,
    getFileHeaderByUniqueId,
    SecurityGroupType,
    type DotYouClient,
    type UploadFileMetadata,
    type UploadInstructionSet,
    type UpdateInstructionSet,
    ScheduleOptions,
    PriorityOptions,
    SendContents,
} from '@homebase-id/js-lib/core';
import { getRandom16ByteArray, toGuidId } from '@homebase-id/js-lib/helpers';
import {
    JOURNAL_DRIVE,
    COLLABORATION_INVITE_FILE_TYPE,
    COLLABORATION_INVITE_DATA_TYPE,
    COLLABORATIVE_FOLDER_ID,
} from './config';
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
        circleIds: string[],
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

        const existingInvite = await getFileHeaderByUniqueId(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            inviteUniqueId,
            { decrypt: false }
        );

        if (existingInvite && existingInvite.fileMetadata.appData.fileType === COLLABORATION_INVITE_FILE_TYPE) {
            const uploadMetadata: UploadFileMetadata = {
                versionTag: existingInvite.fileMetadata.versionTag,
                allowDistribution: true,
                appData: {
                    fileType: COLLABORATION_INVITE_FILE_TYPE,
                    dataType: COLLABORATION_INVITE_DATA_TYPE,
                    uniqueId: inviteUniqueId,
                    groupId: COLLABORATIVE_FOLDER_ID,
                    content: JSON.stringify(inviteContent),
                },
                isEncrypted: true,
                accessControlList: {
                    requiredSecurityGroup: SecurityGroupType.Connected,
                    circleIdList: circleIds,
                },
            };

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
                uploadMetadata,
            );
        } else {
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
                accessControlList: {
                    requiredSecurityGroup: SecurityGroupType.Connected,
                    circleIdList: circleIds,
                },
            };

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

    async deleteInvitation(noteUniqueId: string): Promise<void> {
        const inviteUniqueId = toGuidId(`collab-invite-${noteUniqueId}`);
        const existingInvite = await getFileHeaderByUniqueId(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            inviteUniqueId,
            { decrypt: false }
        );

        if (existingInvite && existingInvite.fileMetadata.appData.fileType === COLLABORATION_INVITE_FILE_TYPE) {
            await deleteFile(this.#dotYouClient, JOURNAL_DRIVE, existingInvite.fileId);
        }
    }
}
