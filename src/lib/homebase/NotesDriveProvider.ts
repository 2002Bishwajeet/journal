import {
    uploadFile,
    patchFile,
    queryBatch,
    deleteFile,
    getFileHeaderByUniqueId,
    getPayloadBytes,
    getContentFromHeaderOrPayload,
    SecurityGroupType,
    type DotYouClient,
    type HomebaseFile,
    type UploadFileMetadata,
    type UploadInstructionSet,
    type UpdateInstructionSet,
    type PayloadFile,
    type ThumbnailFile,
    type EncryptedKeyHeader,
    reUploadFile,
    type PayloadDescriptor
} from '@homebase-id/js-lib/core';
import {
    getFileHeaderOverPeerByUniqueId,
    getPayloadBytesOverPeer,
} from '@homebase-id/js-lib/peer';
import { getRandom16ByteArray, toGuidId } from '@homebase-id/js-lib/helpers';
import { createThumbnails } from '@homebase-id/js-lib/media';
import {
    JOURNAL_DRIVE,
    JOURNAL_FILE_TYPE,
    JOURNAL_DATA_TYPE,
    PAYLOAD_KEY_CONTENT,
    PAYLOAD_KEY_IMAGE_PREFIX,
} from './config';
import type { NoteFileContent, DocumentMetadata } from '@/types';

export interface ImageUploadData {
    file: Blob;
    filename?: string;
}

const YJS_MIME_TYPE = 'application/yjs';

/**
 * NotesDriveProvider handles all note operations with Homebase.
 * Notes are stored as files with JOURNAL_FILE_TYPE (605) and JOURNAL_DATA_TYPE (706).
 * Yjs content is stored as a payload with key PAYLOAD_KEY_CONTENT ('jrnl_txt').
 * Images are stored as payloads with keys like 'jrnl_img0', 'jrnl_img1', etc.
 */
export class NotesDriveProvider {
    #dotYouClient: DotYouClient;

    constructor(dotYouClient: DotYouClient) {
        this.#dotYouClient = dotYouClient;
    }

    /**
     * Query notes from Homebase with pagination.
     * Uses queryBatch with proper cursor params.
     */
    async queryNotes(cursor?: string, pageSize = 50): Promise<{
        notes: HomebaseFile<NoteFileContent>[];
        cursor: string;
    }> {
        const response = await queryBatch(this.#dotYouClient, {
            targetDrive: JOURNAL_DRIVE,
            fileType: [JOURNAL_FILE_TYPE],
        }, {
            maxRecords: pageSize,
            cursorState: cursor,
            includeMetadataHeader: true,
            includeTransferHistory: false,
            ordering: 'newestFirst',
            sorting: 'anyChangeDate',
        });

        const notes = await Promise.all(
            response.searchResults.map(async (file) => {
                const content = await getContentFromHeaderOrPayload<NoteFileContent>(
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
                } as HomebaseFile<NoteFileContent>;
            })
        );

        return { notes, cursor: response.cursorState || '' };
    }

    /**
     * Query notes by folder (using groupId).
     * The folderId is stored as groupId in Homebase for easy filtering.
     */
    async queryNotesByFolder(folderId: string): Promise<HomebaseFile<NoteFileContent>[]> {
        const response = await queryBatch(this.#dotYouClient, {
            targetDrive: JOURNAL_DRIVE,
            fileType: [JOURNAL_FILE_TYPE],
            groupId: [folderId],
        }, {
            maxRecords: 100,
            includeMetadataHeader: true,
            ordering: 'newestFirst',
        });

        return Promise.all(
            response.searchResults.map(async (file) => {
                const content = await getContentFromHeaderOrPayload<NoteFileContent>(
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
                } as HomebaseFile<NoteFileContent>;
            })
        );
    }

    /**
     * Get a single note by uniqueId (local docId).
     * If authorOdinId is provided and differs from the host identity,
     * the note is fetched over peer from the author's identity server.
     *
     * @param uniqueId - The unique ID of the note
     * @param authorOdinId - Optional owner identity; if different from host, fetches over peer
     * @param options - Optional settings (decrypt)
     */
    async getNote(uniqueId: string, authorOdinId?: string, options?: {
        decrypt?: boolean;
    }): Promise<HomebaseFile<NoteFileContent> | null> {
        const hostIdentity = this.#dotYouClient.getHostIdentity();
        const isPeer = authorOdinId && authorOdinId !== hostIdentity;

        if (isPeer) {
            return getFileHeaderOverPeerByUniqueId<NoteFileContent>(
                this.#dotYouClient,
                authorOdinId,
                JOURNAL_DRIVE,
                uniqueId,
                { decrypt: options?.decrypt }
            );
        }

        const header = await getFileHeaderByUniqueId<NoteFileContent>(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            uniqueId,
            { decrypt: options?.decrypt }
        );
        if (!header) return null;

        return header;
    }

    /**
     * Get the Yjs payload for a note.
     * If authorOdinId is provided and differs from the host identity,
     * the payload is fetched over peer from the author's identity server.
     *
     * @param fileId - The remote file ID
     * @param authorOdinId - Optional owner identity; if different from host, fetches over peer
     * @param lastModified - Optional last modified timestamp for caching
     */
    async getNotePayload(fileId: string, authorOdinId?: string, lastModified?: number): Promise<Uint8Array | null> {
        const hostIdentity = this.#dotYouClient.getHostIdentity();
        const isPeer = authorOdinId && authorOdinId !== hostIdentity;

        if (isPeer) {
            const result = await getPayloadBytesOverPeer(
                this.#dotYouClient,
                authorOdinId,
                JOURNAL_DRIVE,
                fileId,
                PAYLOAD_KEY_CONTENT,
                { decrypt: true, lastModified }
            );
            return result?.bytes || null;
        }

        const result = await getPayloadBytes(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            fileId,
            PAYLOAD_KEY_CONTENT,
            { decrypt: true, lastModified }
        );
        return result?.bytes || null;
    }

    /**
     * Create a new note with optional Yjs blob and images.
     */
    async createNote(
        uniqueId: string,
        metadata: DocumentMetadata,
        yjsBlob?: Uint8Array,
        images?: ImageUploadData[],
        options?: {
            encrypt?: boolean;
            onversionConflict?: () => void;
        }
    ): Promise<{ fileId: string; versionTag: string; imagePayloadKeys: string[] }> {
        const noteContent: NoteFileContent = {
            title: metadata.title,
            tags: metadata.tags,
            excludeFromAI: metadata.excludeFromAI,
            isPinned: metadata.isPinned,
        };
        const payloads: PayloadFile[] = [];
        const thumbnails: ThumbnailFile[] = [];
        const imagePayloadKeys: string[] = [];

        // Add Yjs content payload
        if (yjsBlob && yjsBlob.length > 0) {
            payloads.push({
                key: PAYLOAD_KEY_CONTENT,
                payload: new Blob([new Uint8Array(yjsBlob)], {
                    type: YJS_MIME_TYPE,
                }),
                iv: getRandom16ByteArray(),
            });
        }

        // Process images
        if (images) {
            for (let i = 0; i < images.length; i++) {
                const payloadKey = `${PAYLOAD_KEY_IMAGE_PREFIX}${i}`;
                imagePayloadKeys.push(payloadKey);

                if (images[i].file.type.startsWith('image/')) {
                    const { additionalThumbnails, tinyThumb } = await createThumbnails(
                        images[i].file,
                        payloadKey
                    );
                    thumbnails.push(...additionalThumbnails);
                    payloads.push({
                        key: payloadKey,
                        payload: images[i].file,
                        previewThumbnail: tinyThumb,
                        descriptorContent: images[i].filename || images[i].file.type,
                    });
                } else {
                    payloads.push({
                        key: payloadKey,
                        payload: images[i].file,
                        descriptorContent: images[i].filename || images[i].file.type,
                    });
                }
            }
        }


        const uploadMetadata: UploadFileMetadata = {
            allowDistribution: false,
            appData: {
                uniqueId,
                groupId: metadata.folderId, // Group by folder for easy querying
                fileType: JOURNAL_FILE_TYPE,
                dataType: JOURNAL_DATA_TYPE,
                userDate: Date.now(),
                tags: (metadata.tags || []).map(tag => toGuidId(tag)),
                content: JSON.stringify(noteContent),
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
            payloads,
            thumbnails,
            options?.encrypt || true,
            options?.onversionConflict
        );

        if (!result) {
            throw new Error('Failed to create note');
        }

        return {
            fileId: result.file.fileId,
            versionTag: result.newVersionTag,
            imagePayloadKeys,
        };
    }

    /**
     * Update an existing note using patchFile.
     * Uses optimistic concurrency with onVersionConflict for lazy conflict resolution.
     * If authorOdinId differs from host identity, the update is sent over peer
     * using globalTransitId instead of fileId.
     *
     * @param uniqueId - The unique ID of the note
     * @param fileId - The remote file ID
     * @param versionTag - The cached version tag (may be stale)
     * @param metadata - Document metadata to update
     * @param authorOdinId - Owner identity; if different from host, updates over peer
     * @param globalTransitId - Required for peer updates to identify the file
     * @param yjsBlob - Optional Yjs blob to update
     * @param cachedKeyHeader - Optional cached encrypted key header (avoids network call)
     * @returns The new versionTag and the encryptedKeyHeader used (for caching)
     */
    async updateNote(
        uniqueId: string,
        fileId: string,
        versionTag: string,
        metadata: DocumentMetadata,
        authorOdinId?: string,
        globalTransitId?: string,
        yjsBlob?: Uint8Array,
        cachedKeyHeader?: EncryptedKeyHeader,
        options?: {
            onVersionConflict?: () => void;
            toDeletePayloads?: { key: string }[];
        }
    ): Promise<{ versionTag: string; encryptedKeyHeader?: EncryptedKeyHeader }> {
        const hostIdentity = this.#dotYouClient.getHostIdentity();
        const isPeer = authorOdinId && authorOdinId !== hostIdentity;

        const noteContent: NoteFileContent = {
            title: metadata.title,
            tags: metadata.tags,
            excludeFromAI: metadata.excludeFromAI,
            isPinned: metadata.isPinned,
        };
        const payloads: PayloadFile[] = [];

        if (yjsBlob && yjsBlob.length > 0) {
            payloads.push({
                key: PAYLOAD_KEY_CONTENT,
                payload: new Blob([new Uint8Array(yjsBlob)], { type: YJS_MIME_TYPE }),
                iv: getRandom16ByteArray(),
            });
        }

        const uploadMetadata: UploadFileMetadata = {
            versionTag,
            allowDistribution: false,
            appData: {
                uniqueId,
                groupId: metadata.folderId,
                fileType: JOURNAL_FILE_TYPE,
                dataType: JOURNAL_DATA_TYPE,
                userDate: Date.now(),
                tags: (metadata.tags || []).map(tag => toGuidId(tag)),
                content: JSON.stringify(noteContent),
            },
            isEncrypted: true,
            accessControlList: {
                requiredSecurityGroup: SecurityGroupType.Owner,
            },
        };

        const updateInstructions: UpdateInstructionSet = isPeer
            ? {
                locale: 'peer' as const,
                file: {
                    globalTransitId: globalTransitId!,
                    targetDrive: JOURNAL_DRIVE,
                },
                versionTag,
            }
            : {
                locale: 'local' as const,
                file: { fileId, targetDrive: JOURNAL_DRIVE },
                versionTag,
            };


        const result = await patchFile(
            this.#dotYouClient,
            cachedKeyHeader,
            updateInstructions,
            uploadMetadata,
            payloads,
            undefined, // thumbnails
            options?.toDeletePayloads,
            options?.onVersionConflict
        );

        if (!result) {
            throw new Error('Failed to update note');
        }

        return {
            versionTag: result.newVersionTag,
            encryptedKeyHeader: cachedKeyHeader,
        };
    }

    /**
     * Add an image to an existing note using patchFile.
     * Uses uniqueId to look up the file, ensuring consistency with how notes are tracked.
     */
    //TODO: This corrupts the previous note data
    async addImageToNote(
        uniqueId: string,
        versionTag: string,
        image: ImageUploadData,
    ): Promise<{ versionTag: string; payloadKey: string }> {
        // Fetch existing file header by uniqueId to get encryption key and fileId
        const existingHeader = await this.getNote(
            uniqueId,
            undefined,
            { decrypt: true }
        );


        if (!existingHeader) {
            throw new Error(`Cannot add image: note with uniqueId ${uniqueId} not found`);
        }
        const payloadCount = existingHeader?.fileMetadata.payloads?.filter(
            (p: PayloadDescriptor) => p.key.startsWith('jrnl_img')
        ).length || 0;

        const fileId = existingHeader.fileId;
        const appData = existingHeader.fileMetadata.appData

        const payloadKey = `${PAYLOAD_KEY_IMAGE_PREFIX}${payloadCount}`;
        const payloads: PayloadFile[] = [];
        const thumbnails: ThumbnailFile[] = [];

        if (image.file.type.startsWith('image/')) {
            const { additionalThumbnails, tinyThumb } = await createThumbnails(
                image.file,
                payloadKey
            );
            thumbnails.push(...additionalThumbnails);
            payloads.push({
                key: payloadKey,
                iv: existingHeader.fileMetadata.isEncrypted ? getRandom16ByteArray() : undefined,
                payload: image.file,
                previewThumbnail: tinyThumb,
                descriptorContent: image.filename || image.file.type,
            });
        } else {
            payloads.push({
                key: payloadKey,
                payload: image.file,
                descriptorContent: image.filename || image.file.type,
            });
        }

        const uploadMetadata: UploadFileMetadata = {
            versionTag: existingHeader.fileMetadata.versionTag,
            allowDistribution: false,
            appData: {
                ...appData,
                content: JSON.stringify(appData.content),
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
            versionTag: existingHeader.fileMetadata.versionTag || versionTag,
        };

        const result = await patchFile(
            this.#dotYouClient,
            existingHeader?.sharedSecretEncryptedKeyHeader,
            updateInstructions,
            uploadMetadata,
            payloads,
            thumbnails
        );

        if (!result) {
            throw new Error('Failed to add image to note');
        }

        return {
            versionTag: result.newVersionTag,
            payloadKey,
        };
    }

    /**
     * Delete a note from Homebase
     */
    async deleteNote(fileId: string): Promise<void> {
        await deleteFile(this.#dotYouClient, JOURNAL_DRIVE, fileId);
    }

    /**
     * Update a note's access control to make it publicly accessible (Anonymous).
     * This is used for the Share feature.
     *  TODO(2002Bishwajeet): Create a new collaborative note drive which has access to anonymous and public notes and move there
     * @param uniqueId - The unique ID of the note
     * @returns The new version tag after update
     */
    async makeNotePublic(uniqueId: string): Promise<{ versionTag: string }> {
        // Fetch existing file header
        const existingHeader = await getFileHeaderByUniqueId<NoteFileContent>(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            uniqueId,
            { decrypt: false }
        );

        if (!existingHeader) {
            throw new Error(`Note with uniqueId ${uniqueId} not found`);
        }


        const versionTag = existingHeader.fileMetadata.versionTag;

        // Update metadata with Anonymous access control
        const uploadMetadata: UploadFileMetadata = {
            versionTag,
            allowDistribution: true, // Allow distribution for public access
            appData: {
                fileType: JOURNAL_FILE_TYPE,
                dataType: JOURNAL_DATA_TYPE,
                uniqueId,
            },
            isEncrypted: false, // Public notes should not be encrypted
            accessControlList: {
                requiredSecurityGroup: SecurityGroupType.Anonymous,
            },
        };
        const uploadInstructionSet: UploadInstructionSet = {
            storageOptions: { drive: JOURNAL_DRIVE, overwriteFileId: existingHeader.fileId },
            transferIv: getRandom16ByteArray(),
        }

        const result = await reUploadFile(this.#dotYouClient, uploadInstructionSet, uploadMetadata, false);

        if (!result) {
            throw new Error('Failed to make note public');
        }

        return { versionTag: result.newVersionTag };
    }

    /**
     * Update a note's access control back to private (Owner only).
     * This revokes public sharing.
     * 
     * @param uniqueId - The unique ID of the note
     * @returns The new version tag after update
     */
    async makeNotePrivate(uniqueId: string): Promise<{ versionTag: string }> {
        // Fetch existing file header
        const existingHeader = await getFileHeaderByUniqueId<NoteFileContent>(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            uniqueId,
            { decrypt: false }
        );

        if (!existingHeader) {
            throw new Error(`Note with uniqueId ${uniqueId} not found`);
        }

        // Update metadata with Owner access control
        const uploadMetadata: UploadFileMetadata = {
            allowDistribution: false,
            appData: {
                fileType: JOURNAL_FILE_TYPE,
                dataType: JOURNAL_DATA_TYPE,
                uniqueId,
            },
            isEncrypted: true, // Private notes should be encrypted
            accessControlList: {
                requiredSecurityGroup: SecurityGroupType.Owner,
            },
        };

        const updateInstructions: UploadInstructionSet = {
            storageOptions: { drive: JOURNAL_DRIVE, overwriteFileId: existingHeader.fileId },
            transferIv: getRandom16ByteArray(),
        };

        const result = await reUploadFile(this.#dotYouClient, updateInstructions, uploadMetadata, true);

        if (!result) {
            throw new Error('Failed to make note private');
        }

        return { versionTag: result.newVersionTag };
    }

    /**
     * Make a note collaborative, granting access to specified circles.
     * Changes ACL to Connected with circleIds and moves to COLLABORATIVE_FOLDER_ID.
     * 
     * @param uniqueId - The unique ID of the note
     * @param circleIds - Array of circle IDs to grant access
     * @param editorOdinId - OdinId of the user making this change
     * @returns The new version tag after update
     */
    async makeNoteCollaborative(
        uniqueId: string,
        circleIds: string[],
        recipients: string[],
        editorOdinId: string
    ): Promise<{ versionTag: string }> {
        const { COLLABORATIVE_FOLDER_ID } = await import('./config');

        // Fetch existing file header
        const existingHeader = await getFileHeaderByUniqueId<NoteFileContent>(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            uniqueId,
            { decrypt: false }
        );

        if (!existingHeader) {
            throw new Error(`Note with uniqueId ${uniqueId} not found`);
        }

        // Get existing content to preserve it
        const existingContent = existingHeader.fileMetadata.appData.content as NoteFileContent | undefined;

        // Build updated note content with collaborative metadata
        const noteContent: NoteFileContent = {
            title: existingContent?.title || '',
            tags: existingContent?.tags || [],
            excludeFromAI: existingContent?.excludeFromAI || false,
            isPinned: existingContent?.isPinned || false,
            isCollaborative: true,
            circleIds,
            recipients,
            lastEditedBy: editorOdinId,
        };

        const versionTag = existingHeader.fileMetadata.versionTag;

        // Update metadata with Connected access control for circles
        const uploadMetadata: UploadFileMetadata = {
            versionTag,
            allowDistribution: false,
            appData: {
                fileType: JOURNAL_FILE_TYPE,
                dataType: JOURNAL_DATA_TYPE,
                uniqueId,
                groupId: COLLABORATIVE_FOLDER_ID, // Move to collaborative folder
                content: JSON.stringify(noteContent),
            },
            isEncrypted: true,
            accessControlList: {
                requiredSecurityGroup: SecurityGroupType.Connected,
                circleIdList: circleIds,
            },
        };

        const updateInstructions: UpdateInstructionSet = {
            locale: 'local',
            file: { fileId: existingHeader.fileId, targetDrive: JOURNAL_DRIVE },
            versionTag,
        };

        const result = await patchFile(
            this.#dotYouClient,
            existingHeader.sharedSecretEncryptedKeyHeader,
            updateInstructions,
            uploadMetadata,
            [], // no payloads to update
            undefined, // no thumbnails
            undefined, // no payloads to delete
        );

        if (!result) {
            throw new Error('Failed to make note collaborative');
        }

        return { versionTag: result.newVersionTag };
    }

    /**
     * Revoke collaboration, returning note to private (Owner only).
     * Moves note back to MAIN_FOLDER_ID.
     * 
     * @param uniqueId - The unique ID of the note
     * @param editorOdinId - OdinId of the user making this change
     * @returns The new version tag after update
     */
    async revokeNoteCollaboration(
        uniqueId: string,
        editorOdinId: string
    ): Promise<{ versionTag: string }> {
        // Import MAIN_FOLDER_ID dynamically to avoid circular deps
        const { MAIN_FOLDER_ID } = await import('./config');

        // Fetch existing file header
        const existingHeader = await getFileHeaderByUniqueId<NoteFileContent>(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            uniqueId,
            { decrypt: false }
        );

        if (!existingHeader) {
            throw new Error(`Note with uniqueId ${uniqueId} not found`);
        }

        // Get existing content to preserve it
        const existingContent = existingHeader.fileMetadata.appData.content as NoteFileContent | undefined;

        // Build updated note content - remove collaborative metadata
        const noteContent: NoteFileContent = {
            title: existingContent?.title || '',
            tags: existingContent?.tags || [],
            excludeFromAI: existingContent?.excludeFromAI || false,
            isPinned: existingContent?.isPinned || false,
            isCollaborative: false,
            circleIds: undefined,
            lastEditedBy: editorOdinId,
        };

        // Update metadata with Owner access control
        const uploadMetadata: UploadFileMetadata = {
            allowDistribution: false,
            appData: {
                fileType: JOURNAL_FILE_TYPE,
                dataType: JOURNAL_DATA_TYPE,
                uniqueId,
                groupId: MAIN_FOLDER_ID, // Move back to main folder
                content: JSON.stringify(noteContent),
            },
            isEncrypted: true, // Private notes should be encrypted
            accessControlList: {
                requiredSecurityGroup: SecurityGroupType.Owner,
            },
        };

        const versionTag = existingHeader.fileMetadata.versionTag;

        const updateInstructions: UpdateInstructionSet = {
            locale: 'local',
            file: { fileId: existingHeader.fileId, targetDrive: JOURNAL_DRIVE },
            versionTag,
        };

        const result = await patchFile(
            this.#dotYouClient,
            undefined, // no cached key header needed
            updateInstructions,
            uploadMetadata,
            [], // no payloads to update
            undefined, // no thumbnails
            undefined, // no payloads to delete
        );

        if (!result) {
            throw new Error('Failed to revoke note collaboration');
        }

        return { versionTag: result.newVersionTag };
    }
}
