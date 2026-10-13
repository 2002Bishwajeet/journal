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
    getPayloadBytes,
    deleteFilesByGroupId
} from '@homebase-id/js-lib/core';
import { getRandom16ByteArray } from '@homebase-id/js-lib/helpers';
import { GetProfileCard } from '@homebase-id/js-lib/public';
import { tryJsonParse } from '@/lib/utils';
import {
    JOURNAL_DRIVE,
    FOLDER_FILE_TYPE,
    FOLDER_DATA_TYPE,
    PAYLOAD_KEY_CARD_IMAGE,
} from './config';
import type { FolderFile } from '@/types';
import { folderCardExcerpt, sameFolderCardFrom, type FolderCard, type FolderCardFrom } from '@/lib/share/folderCard';

/** A new folder card image to store with the folder file, and the content that names it. */
export interface FolderCardUpload {
    image: Blob;
    card: FolderCard;
}

const cardPayloads = (upload?: FolderCardUpload) => (upload ? [{ key: PAYLOAD_KEY_CARD_IMAGE, payload: upload.image }] : []);

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
            cardImage?: Blob;
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
            cardPayloads(options?.cardImage && { image: options.cardImage, card: folder.card! }), [], isEncrypted, options?.onVersionConflict
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
        folder: FolderFile,
        cardImage?: Blob
    ): Promise<{ versionTag: string }> {
        const upload = cardImage && { image: cardImage, card: folder.card! };
        const isEncrypted = !folder.isPublic;
        // Fetch existing file header to get encryption key
        const existingHeader = await getFileHeader<string>(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            fileId,
            { decrypt: false }
        );
        if (existingHeader && existingHeader.fileMetadata.isEncrypted !== isEncrypted) {
            return this.#reuploadFolder(fileId, folder, upload);
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
            cardPayloads(upload)
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
    async #reuploadFolder(fileId: string, folder: FolderFile, upload?: FolderCardUpload): Promise<{ versionTag: string }> {
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

        const result = await uploadFile(this.#dotYouClient, instructions, uploadMetadata, cardPayloads(upload), [], isEncrypted);
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

    /**
     * The link card (#644) a push of `folder` stores: null when the one already drawn
     * (`folder.card`, from the folder's content) shows the same name and count, or when it
     * can't be drawn here (no canvas, or drawing fails: sharing and renaming carry on).
     */
    async drawCardIfStale(folder: FolderFile, count: number, current: FolderCard | undefined): Promise<FolderCardUpload | null> {
        const from = { name: folder.name, count };
        if (current && sameFolderCardFrom(current.from, from)) return null;
        const image = await this.#drawCardImage(from);
        return image && { image, card: { cardImageKey: PAYLOAD_KEY_CARD_IMAGE, from } };
    }

    async #drawCardImage(from: FolderCardFrom): Promise<Blob | null> {
        try {
            const { canRenderCardImage, renderCardImage } = await import('@/lib/share/cardImage');
            if (!canRenderCardImage()) return null;
            const identity = this.#dotYouClient.getHostIdentity();
            const profile = await GetProfileCard(identity).catch(() => undefined);
            return await renderCardImage({ title: from.name, excerpt: folderCardExcerpt(from.count), author: profile?.name || identity });
        } catch (e) {
            console.warn('[FolderDriveProvider] could not draw the card image', e);
            return null;
        }
    }

    /**
     * The card the Share folder dialog previews: the uploaded one when it was drawn from
     * `from`, else the same card drawn here. `fileId` is absent for a folder not pushed yet.
     */
    async getCardImage(fileId: string | undefined, from: FolderCardFrom): Promise<Blob | null> {
        if (fileId) {
            const header = await getFileHeader<string>(this.#dotYouClient, JOURNAL_DRIVE, fileId, { decrypt: false });
            const raw: unknown = header?.fileMetadata.appData.content;
            const content = typeof raw === 'string' ? tryJsonParse<FolderFile>(raw) : (raw as FolderFile | undefined);
            const payload = header?.fileMetadata.payloads?.find((p) => p.key === PAYLOAD_KEY_CARD_IMAGE);
            if (payload && sameFolderCardFrom(content?.card?.from, from)) {
                const data = await getPayloadBytes(this.#dotYouClient, JOURNAL_DRIVE, fileId, PAYLOAD_KEY_CARD_IMAGE, {
                    decrypt: false,
                    lastModified: payload.lastModified,
                });
                if (data) return new Blob([new Uint8Array(data.bytes)], { type: data.contentType });
            }
        }
        return this.#drawCardImage(from);
    }
}
