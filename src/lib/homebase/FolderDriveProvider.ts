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
    type AccessControlList,
    getFileHeader,
    deleteFilesByGroupId
} from '@homebase-id/js-lib/core';
import { getRandom16ByteArray } from '@homebase-id/js-lib/helpers';
import { tryJsonParse } from '@/lib/utils';
import {
    JOURNAL_DRIVE,
    FOLDER_FILE_TYPE,
    FOLDER_DATA_TYPE,
} from './config';
import type { FolderFile } from '@/types';

/**
 * A shared folder (#618) is stored Anonymous + unencrypted, so its public page can read
 * its name logged out; every other folder stays Owner-only.
 */
const folderAcl = (folder: FolderFile): AccessControlList => ({
    requiredSecurityGroup: folder.isPublic ? SecurityGroupType.Anonymous : SecurityGroupType.Owner,
});

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
        // A shared folder is never encrypted, whatever `encrypt` says (mirrors createNote).
        const isEncrypted = folder.isPublic ? false : (options?.encrypt ?? true);
        const uploadMetadata: UploadFileMetadata = {
            allowDistribution: false,
            appData: {
                uniqueId,
                fileType: FOLDER_FILE_TYPE,
                dataType: FOLDER_DATA_TYPE,
                userDate: Date.now(),
                content: JSON.stringify(folder),
            },
            isEncrypted,
            accessControlList: folderAcl(folder),
        };

        const instructionSet: UploadInstructionSet = {
            transferIv: getRandom16ByteArray(),
            storageOptions: { drive: JOURNAL_DRIVE },

        };

        const result = await uploadFile(
            this.#dotYouClient,
            instructionSet,
            uploadMetadata,
            [], [], isEncrypted, options?.onVersionConflict
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
     * Sharing or unsharing it (#618) changes its encryption, which a patch can't do:
     * that re-uploads it instead (see #reuploadFolder).
     */
    async updateFolder(
        fileId: string,
        versionTag: string,
        folder: FolderFile
    ): Promise<{ versionTag: string }> {
        const isEncrypted = !folder.isPublic;
        // Fetch existing file header to get encryption key
        const existingHeader = await getFileHeader<string>(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            fileId,
            { decrypt: false }
        );
        if (existingHeader && existingHeader.fileMetadata.isEncrypted !== isEncrypted) {
            return this.#reuploadFolder(fileId, folder);
        }

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
            isEncrypted,
            accessControlList: folderAcl(folder),
        };

        // UpdateLocalInstructionSet for patchFile
        const updateInstructions: UpdateInstructionSet = {
            locale: 'local',
            file: { fileId, targetDrive: JOURNAL_DRIVE },
            versionTag,
        };

        const result = await patchFile(
            this.#dotYouClient,
            // No key header for a shared folder: it is stored unencrypted.
            isEncrypted ? existingHeader?.sharedSecretEncryptedKeyHeader : undefined,
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
     * Re-upload a folder file with `folder`'s encryption and ACL, as makeNotePublic does
     * for a note: read it decrypted, keep every appData field and every content field
     * `folder` doesn't set (its colour), and write it back over the same file.
     */
    async #reuploadFolder(fileId: string, folder: FolderFile): Promise<{ versionTag: string }> {
        const existing = await getFileHeader<FolderFile>(this.#dotYouClient, JOURNAL_DRIVE, fileId, { decrypt: true });
        if (!existing) throw new Error('Failed to update folder: not found');
        const appData = existing.fileMetadata.appData;
        // Content may come back as a string or an already-parsed object.
        const raw: unknown = appData.content;
        const existingContent = (typeof raw === 'string' ? tryJsonParse<FolderFile>(raw) : (raw as FolderFile | undefined));
        const isEncrypted = !folder.isPublic;

        const uploadMetadata: UploadFileMetadata = {
            versionTag: existing.fileMetadata.versionTag,
            allowDistribution: false,
            appData: { ...appData, content: JSON.stringify({ ...existingContent, ...folder }) },
            isEncrypted,
            accessControlList: folderAcl(folder),
        };
        const instructions: UploadInstructionSet = {
            transferIv: getRandom16ByteArray(),
            storageOptions: { drive: JOURNAL_DRIVE, overwriteFileId: fileId },
        };

        const result = await uploadFile(this.#dotYouClient, instructions, uploadMetadata, [], [], isEncrypted);
        if (!result) {
            throw new Error('Failed to update folder');
        }

        return { versionTag: result.newVersionTag };
    }

    /**
     * Delete a folder from Homebase
     */
    async deleteFolder(fileId: string | undefined, uniqueId: string): Promise<void> {
        // No fileId: the folder file was never uploaded, but its notes may have been
        if (fileId) await deleteFile(this.#dotYouClient, JOURNAL_DRIVE, fileId);
        // Notes are uploaded with groupId = the folder's uniqueId, not its fileId
        await deleteFilesByGroupId(this.#dotYouClient, JOURNAL_DRIVE, [uniqueId]);
    }


    async dsrToFolderFileContent(dsr: HomebaseFile<string>,
        includeMetadataHeader: boolean): Promise<FolderFile | null> {
        try {
            const folderFileContent = await getContentFromHeaderOrPayload<FolderFile>(this.#dotYouClient, JOURNAL_DRIVE, dsr, includeMetadataHeader);
            if (!folderFileContent) {
                return null;
            }
            return folderFileContent;

        } catch (error) {
            console.error('[FolderDriveProvider] failed to get the folderFileContent of a dsr', dsr, error);
            return null;

        }
    }
}
