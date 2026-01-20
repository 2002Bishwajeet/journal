import {
    uploadFile,
    patchFile,
    queryBatch,
    deleteFile,
    getFileHeaderByUniqueId,
    getContentFromHeaderOrPayload,
    SecurityGroupType,
    type DotYouClient,
    type HomebaseFile,
    type UploadFileMetadata,
    type UploadInstructionSet,
    type UpdateInstructionSet,
    getFileHeader,
    deleteFilesByGroupId,
} from '@homebase-id/js-lib/core';
import { getRandom16ByteArray } from '@homebase-id/js-lib/helpers';
import {
    JOURNAL_DRIVE,
    FOLDER_FILE_TYPE,
    FOLDER_DATA_TYPE,
} from './config';
import type { FolderFile } from '@/types';

/**
 * FolderDriveProvider handles all folder operations with Homebase.
 * Folders are stored as files with FOLDER_FILE_TYPE (606) and FOLDER_DATA_TYPE (707).
 */
export class FolderDriveProvider {
    #dotYouClient: DotYouClient;

    constructor(dotYouClient: DotYouClient) {
        this.#dotYouClient = dotYouClient;
    }

    /**
     * Query all folders from Homebase drive
     */
    async queryFolders(cursor?: string): Promise<{
        folders: HomebaseFile<FolderFile>[];
        cursor: string;
    }> {
        const response = await queryBatch(this.#dotYouClient, {
            targetDrive: JOURNAL_DRIVE,
            fileType: [FOLDER_FILE_TYPE],
        }, {
            maxRecords: 100,
            cursorState: cursor,
            includeMetadataHeader: true,
            includeTransferHistory: false,
            ordering: 'newestFirst',
            sorting: 'anyChangeDate',
        });

        const folders = await Promise.all(
            response.searchResults.map(async (file) => {
                const content = await getContentFromHeaderOrPayload<FolderFile>(
                    this.#dotYouClient,
                    JOURNAL_DRIVE,
                    file,
                    true
                );

                return {
                    ...file,
                    fileMetadata: {
                        ...file.fileMetadata,
                        appData: { ...file.fileMetadata.appData, content: content },
                    },
                } as HomebaseFile<FolderFile>;
            })
        );

        return { folders, cursor: response.cursorState || '' };
    }

    /**
     * Get a single folder by uniqueId (local folder ID)
     */
    async getFolder(uniqueId: string, options?: {
        decrypt?: boolean;
    }): Promise<HomebaseFile<FolderFile> | null> {
        const header = await getFileHeaderByUniqueId<FolderFile>(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            uniqueId,
            { decrypt: options?.decrypt }
        );
        if (!header) return null;
        return header;
    }


    async createFolder(
        uniqueId: string,
        folder: FolderFile,
        options?: {
            onVersionConflict?: () => void;
            encrypt?: boolean;
        }
    ): Promise<{ fileId: string; versionTag: string }> {
        const uploadMetadata: UploadFileMetadata = {
            allowDistribution: false,
            appData: {
                uniqueId,
                fileType: FOLDER_FILE_TYPE,
                dataType: FOLDER_DATA_TYPE,
                userDate: Date.now(),
                content: JSON.stringify(folder),
            },
            isEncrypted: options?.encrypt || true,
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
            [], [], options?.encrypt || true, options?.onVersionConflict
        );

        if (!result) {
            throw new Error('Failed to create folder');
        }

        return {
            fileId: result.file.fileId,
            versionTag: result.newVersionTag,
        };
    }

    /**
     * Update an existing folder using patchFile.
     * versionTag is required for updates to handle optimistic locking.
     * Fetches existing file header to get encryption key.
     */
    async updateFolder(
        fileId: string,
        versionTag: string,
        folder: FolderFile
    ): Promise<{ versionTag: string }> {
        // Fetch existing file header to get encryption key
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
                fileType: FOLDER_FILE_TYPE,
                dataType: FOLDER_DATA_TYPE,
                userDate: Date.now(),
                content: JSON.stringify(folder),
                uniqueId: existingHeader?.fileMetadata.appData.uniqueId,
            },
            isEncrypted: true,
            accessControlList: {
                requiredSecurityGroup: SecurityGroupType.Owner,
            },
        };

        // UpdateLocalInstructionSet for patchFile
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
            []
        );

        if (!result) {
            throw new Error('Failed to update folder');
        }

        return { versionTag: result.newVersionTag };
    }

    /**
     * Delete a folder from Homebase
     */
    async deleteFolder(fileId: string): Promise<void> {
        await deleteFile(this.#dotYouClient, JOURNAL_DRIVE, fileId);
        await deleteFilesByGroupId(this.#dotYouClient, JOURNAL_DRIVE, [fileId]);
    }
}
