import {
    uploadFile,
    getFileHeaderByUniqueId,
    SecurityGroupType,
    type DotYouClient,
    type UploadFileMetadata,
    type UploadInstructionSet,
} from '@homebase-id/js-lib/core';
import { getRandom16ByteArray } from '@homebase-id/js-lib/helpers';
import {
    JOURNAL_DRIVE,
    WELCOME_SEEDED_FILE_TYPE,
    WELCOME_SEEDED_DATA_TYPE,
    WELCOME_SEEDED_UNIQUE_ID,
} from './config';

/**
 * The "welcome note seeded" marker (#1283): one empty file with a fixed uniqueId on JOURNAL_DRIVE,
 * so every device of an identity can tell the welcome note was already offered. Sync never
 * queries this fileType, so it never shows up as a note.
 */
export class WelcomeSeededDriveProvider {
    #dotYouClient: DotYouClient;

    constructor(dotYouClient: DotYouClient) {
        this.#dotYouClient = dotYouClient;
    }

    async exists(): Promise<boolean> {
        const header = await getFileHeaderByUniqueId(this.#dotYouClient, JOURNAL_DRIVE, WELCOME_SEEDED_UNIQUE_ID);
        return !!header;
    }

    async mark(): Promise<void> {
        const uploadMetadata: UploadFileMetadata = {
            allowDistribution: false,
            appData: {
                uniqueId: WELCOME_SEEDED_UNIQUE_ID,
                fileType: WELCOME_SEEDED_FILE_TYPE,
                dataType: WELCOME_SEEDED_DATA_TYPE,
                content: JSON.stringify({ version: 1 }),
            },
            isEncrypted: true,
            accessControlList: { requiredSecurityGroup: SecurityGroupType.Owner },
        };
        const instructionSet: UploadInstructionSet = {
            transferIv: getRandom16ByteArray(),
            storageOptions: { drive: JOURNAL_DRIVE },
        };
        await uploadFile(this.#dotYouClient, instructionSet, uploadMetadata, [], [], true);
    }
}
