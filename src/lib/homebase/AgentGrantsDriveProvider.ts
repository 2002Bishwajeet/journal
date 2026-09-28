import {
    uploadFile,
    patchFile,
    getFileHeaderByUniqueId,
    getFileHeader,
    getPayloadBytes,
    SecurityGroupType,
    type DotYouClient,
    type UploadFileMetadata,
    type UploadInstructionSet,
    type UpdateInstructionSet,
    type PayloadFile,
} from '@homebase-id/js-lib/core';
import { getRandom16ByteArray } from '@homebase-id/js-lib/helpers';
import {
    JOURNAL_DRIVE,
    AGENT_GRANTS_FILE_TYPE,
    AGENT_GRANTS_DATA_TYPE,
    AGENT_GRANTS_UNIQUE_ID,
    PAYLOAD_KEY_AGENT_GRANTS,
} from './config';
import { type AgentGrants, EMPTY_GRANTS, parseGrants } from '@/lib/agent/grants';

const GRANTS_MIME_TYPE = 'application/json';

/**
 * AgentGrantsDriveProvider stores the single encrypted agent-access grants file on
 * JOURNAL_DRIVE (fileType 607 / dataType 708, fixed uniqueId — one per identity).
 * Sync never queries this fileType, so it never shows up as a note (#164).
 */
export class AgentGrantsDriveProvider {
    #dotYouClient: DotYouClient;

    constructor(dotYouClient: DotYouClient) {
        this.#dotYouClient = dotYouClient;
    }

    /**
     * Load the grants file. No file yet → EMPTY_GRANTS with no fileId/versionTag.
     */
    async load(): Promise<{ grants: AgentGrants; versionTag?: string; fileId?: string }> {
        const header = await getFileHeaderByUniqueId<string>(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            AGENT_GRANTS_UNIQUE_ID
        );
        if (!header) return { grants: EMPTY_GRANTS };

        const payload = await getPayloadBytes(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            header.fileId,
            PAYLOAD_KEY_AGENT_GRANTS,
            { decrypt: true }
        );

        const grants = payload
            ? parseGrants(JSON.parse(new TextDecoder().decode(payload.bytes)))
            : EMPTY_GRANTS;

        return {
            grants,
            versionTag: header.fileMetadata.versionTag,
            fileId: header.fileId,
        };
    }

    /**
     * Save the grants file. No fileId → create it (uploadFile). With fileId → update it
     * (patchFile) using the given versionTag. On version conflict, throws
     * AGENT_GRANTS_CONFLICT — callers reload and retry; last explicit user choice wins,
     * there is no merge.
     */
    async save(
        grants: AgentGrants,
        versionTag?: string,
        fileId?: string
    ): Promise<{ versionTag: string; fileId: string }> {
        const onVersionConflict = () => {
            throw new Error('AGENT_GRANTS_CONFLICT');
        };

        const payloads: PayloadFile[] = [{
            key: PAYLOAD_KEY_AGENT_GRANTS,
            payload: new Blob([JSON.stringify(grants)], { type: GRANTS_MIME_TYPE }),
            iv: getRandom16ByteArray(),
        }];

        if (!fileId) {
            const uploadMetadata: UploadFileMetadata = {
                allowDistribution: false,
                appData: {
                    uniqueId: AGENT_GRANTS_UNIQUE_ID,
                    fileType: AGENT_GRANTS_FILE_TYPE,
                    dataType: AGENT_GRANTS_DATA_TYPE,
                    content: JSON.stringify({ version: 1 }),
                },
                isEncrypted: true,
                accessControlList: {
                    requiredSecurityGroup: SecurityGroupType.Owner,
                },
            };

            const instructionSet: UploadInstructionSet = {
                transferIv: getRandom16ByteArray(),
                storageOptions: { drive: JOURNAL_DRIVE },
            };

            const result = await uploadFile(
                this.#dotYouClient,
                instructionSet,
                uploadMetadata,
                payloads,
                [],
                true,
                onVersionConflict
            );

            if (!result) throw new Error('Failed to save agent grants');

            return { fileId: result.file.fileId, versionTag: result.newVersionTag };
        }

        const existingHeader = await getFileHeader<string>(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            fileId,
            { decrypt: false }
        );

        const uploadMetadata: UploadFileMetadata = {
            versionTag,
            allowDistribution: false,
            appData: {
                uniqueId: AGENT_GRANTS_UNIQUE_ID,
                fileType: AGENT_GRANTS_FILE_TYPE,
                dataType: AGENT_GRANTS_DATA_TYPE,
                content: JSON.stringify({ version: 1 }),
            },
            isEncrypted: true,
            accessControlList: {
                requiredSecurityGroup: SecurityGroupType.Owner,
            },
        };

        const updateInstructions: UpdateInstructionSet = {
            locale: 'local',
            file: { fileId, targetDrive: JOURNAL_DRIVE },
            versionTag,
        };

        const result = await patchFile(
            this.#dotYouClient,
            existingHeader?.sharedSecretEncryptedKeyHeader,
            updateInstructions,
            uploadMetadata,
            payloads,
            undefined,
            undefined,
            onVersionConflict
        );

        if (!result) throw new Error('Failed to save agent grants');

        return { fileId, versionTag: result.newVersionTag };
    }
}
