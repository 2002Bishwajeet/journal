import {
    uploadFile,
    patchFile,
    queryBatch,
    deleteFile,
    getFileHeader,
    getFileHeaderByUniqueId,
    getPayloadBytes,
    getThumbBytes,
    getContentFromHeaderOrPayload,
    SecurityGroupType,
    type AccessControlList,
    type DotYouClient,
    type HomebaseFile,
    type UploadFileMetadata,
    type UploadInstructionSet,
    type UpdateInstructionSet,
    type PayloadFile,
    type ThumbnailFile,
    type EncryptedKeyHeader,
    type ImageSize,
} from '@homebase-id/js-lib/core';
import {
    getFileHeaderOverPeerByUniqueId,
    getPayloadBytesOverPeer,
} from '@homebase-id/js-lib/peer';
import { getRandom16ByteArray, tryJsonParse } from '@homebase-id/js-lib/helpers';
import { GetProfileCard } from '@homebase-id/js-lib/public';
import {
    JOURNAL_DRIVE,
    JOURNAL_FILE_TYPE,
    JOURNAL_DATA_TYPE,
    PAYLOAD_KEY_CONTENT,
    PAYLOAD_KEY_IMAGE_PREFIX,
    PAYLOAD_KEY_CARD_IMAGE,
    COLLABORATIVE_FOLDER_ID,
    MAIN_FOLDER_ID,
} from './config';
import type { NoteFileContent, DocumentMetadata } from '@/types';
import { buildPublicCard, sameCardImageFrom, type CardImageFrom, type PublicCard } from '@/lib/share/publicCard';
import { parseAttachmentSrc } from '@/lib/utils/attachmentSrc';
import { noteAcl, noteAppData, noteFileContent } from './noteUploadMetadata';
import { buildContentPayloads, buildImagePayload } from './noteImagePayloads';
import { InvitationDriveProvider } from './InvitationDriveProvider';

export interface ImageUploadData {
    file: Blob;
    filename?: string;
    /** Set where thumbnails can't be drawn (no canvas); see buildImagePayload. */
    naturalSize?: ImageSize;
}

/** A card with no keys is left out of the public header content entirely. */
const nonEmptyCard = (card: PublicCard): PublicCard | undefined =>
    Object.keys(card).length > 0 ? card : undefined;

/** What the file's card image payload was drawn from, per the card in its header; undefined without one. */
function drawnCardImageFrom(header: HomebaseFile<NoteFileContent>): CardImageFrom | undefined {
    if (!header.fileMetadata.payloads?.some((p) => p.key === PAYLOAD_KEY_CARD_IMAGE)) return undefined;
    // Content may come back as a string or an already-parsed object (see makeNotePublic).
    const raw: unknown = header.fileMetadata.appData.content;
    const content = typeof raw === 'string' ? tryJsonParse<{ card?: PublicCard }>(raw) : (raw as { card?: PublicCard } | undefined);
    return content?.card?.cardImageFrom;
}

/** Whether the file's card image payload was drawn from `from`, per the card in its header. */
function isCardImageCurrent(header: HomebaseFile<NoteFileContent>, from: CardImageFrom): boolean {
    const drawn = drawnCardImageFrom(header);
    return !!drawn && sameCardImageFrom(drawn, from);
}

/**
 * NotesDriveProvider handles all note operations with Homebase.
 * Notes are stored as files with JOURNAL_FILE_TYPE (605) and JOURNAL_DATA_TYPE (706).
 * Yjs content is stored as a payload with key PAYLOAD_KEY_CONTENT ('jrnl_txt').
 * Images are stored as payloads with keys like 'jrnl_img0', 'jrnl_img1', etc.
 */
export class NotesDriveProvider {
    #dotYouClient: DotYouClient;
    #invitations: InvitationDriveProvider;

    constructor(dotYouClient: DotYouClient) {
        this.#dotYouClient = dotYouClient;
        this.#invitations = new InvitationDriveProvider(dotYouClient);
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
            try {
                return await getFileHeaderOverPeerByUniqueId<NoteFileContent>(
                    this.#dotYouClient,
                    authorOdinId,
                    JOURNAL_DRIVE,
                    uniqueId,
                    { decrypt: options?.decrypt }
                );
            } catch (err) {
                console.error('[NotesDriveProvider.getNote] peer fetch failed:', err);
                throw err;
            }
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
            try {
                const result = await getPayloadBytesOverPeer(
                    this.#dotYouClient,
                    authorOdinId,
                    JOURNAL_DRIVE,
                    fileId,
                    PAYLOAD_KEY_CONTENT,
                    { decrypt: true, lastModified }
                );
                return result?.bytes || null;
            } catch (err) {
                console.error('[NotesDriveProvider.getNotePayload] peer fetch failed:', err);
                throw err;
            }
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
        // A public note is stored unencrypted; the server rejects a payload IV
        // (invalidUpload) when the file header isn't encrypted. Drive isEncrypted, the
        // payload IV, and the ACL below off metadata.isPublic so they can't diverge
        // (mirrors updateNote). Honor the encrypt option for non-public notes.
        const isEncrypted = metadata.isPublic ? false : (options?.encrypt ?? true);
        const payloads: PayloadFile[] = buildContentPayloads(yjsBlob, isEncrypted);
        const thumbnails: ThumbnailFile[] = [];
        const imagePayloadKeys: string[] = [];

        // Process images
        if (images) {
            for (let i = 0; i < images.length; i++) {
                const payloadKey = `${PAYLOAD_KEY_IMAGE_PREFIX}${i}`;
                imagePayloadKeys.push(payloadKey);
                const image = await buildImagePayload(images[i].file, images[i].filename, payloadKey);
                payloads.push(image.payload);
                thumbnails.push(...image.thumbnails);
            }
        }

        const uploadMetadata: UploadFileMetadata = {
            allowDistribution: false,
            appData: noteAppData(uniqueId, metadata, JSON.stringify(noteFileContent(metadata))),
            isEncrypted,
            accessControlList: noteAcl(metadata),
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
            isEncrypted,
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
            ...noteFileContent(metadata),
            isCollaborative: metadata.isCollaborative,
            circleIds: metadata.circleIds,
            recipients: metadata.recipients,
            lastEditedBy: metadata.lastEditedBy,
        };
        // A public note's content is stored unencrypted (world-readable). Project
        // it to a minimal, non-sensitive subset so the owner's social graph
        // (circleIds/recipients) and lastEditedBy never leak into plaintext. The
        // private branch keeps the full object, so making a note private restores it.
        // The owner-authored share fields are meant to be public; undefined ones (and
        // an empty link card) are dropped by JSON.stringify.
        const card = metadata.isPublic ? buildPublicCard(yjsBlob, metadata) : undefined;
        // The card image rides on this same patch. Without the content we can't tell
        // whether the cover changed, so a content-less save leaves it alone.
        const cardChange = card && yjsBlob && !isPeer ? await this.#cardImageChange(fileId, card.cardImageFrom) : undefined;
        // A card kept as it is (it couldn't be redrawn here) keeps saying what it was drawn from, so the app redraws it.
        if (card && cardChange?.kept) card.cardImageFrom = cardChange.keptFrom;
        const serializedContent = card
            ? JSON.stringify({
                title: metadata.title,
                tags: metadata?.tags || [],
                isPublic: true,
                shareDescription: metadata.shareDescription,
                shareIndexable: metadata.shareIndexable,
                card: nonEmptyCard(card),
            })
            : JSON.stringify(noteContent);
        // A public note is stored unencrypted; the server rejects a payload IV
        // (invalidUpload) when the file header isn't encrypted. Keep the IV and
        // isEncrypted below driven by this one flag so they can't diverge.
        const isEncrypted = !metadata.isPublic;
        const payloads = buildContentPayloads(yjsBlob, isEncrypted);
        let toDeletePayloads = options?.toDeletePayloads;
        if (cardChange?.upload) payloads.push({ key: PAYLOAD_KEY_CARD_IMAGE, payload: cardChange.upload });
        if (cardChange?.remove) toDeletePayloads = [...(toDeletePayloads ?? []), { key: PAYLOAD_KEY_CARD_IMAGE }];

        const uploadMetadata: UploadFileMetadata = {
            versionTag,
            allowDistribution: isPeer ? true : false,
            appData: noteAppData(uniqueId, metadata, serializedContent),
            isEncrypted,
            // A public note is stored Anonymous + unencrypted (see makeNotePublic).
            // Editing one must NOT re-encrypt it or revert the ACL to Owner, or the
            // share breaks and the SDK tries to encrypt with a key the file lacks.
            accessControlList: noteAcl(metadata),
        };

        // A peer update is addressed by globalTransitId, not fileId; without it the
        // SDK would send `undefined` and patch the wrong (or no) file.
        if (isPeer && !globalTransitId) {
            throw new Error(`Peer update requires globalTransitId for ${uniqueId}`);
        }

        const updateInstructions: UpdateInstructionSet = isPeer && globalTransitId
            ? {
                locale: 'peer' as const,
                file: {
                    globalTransitId,
                    targetDrive: JOURNAL_DRIVE,
                },
                recipients: [authorOdinId],
                versionTag,
            }
            : {
                locale: 'local' as const,
                file: { fileId, targetDrive: JOURNAL_DRIVE },
                versionTag,
            };

        const result = await patchFile(
            this.#dotYouClient,
            // No key header for a public note — it's stored unencrypted, so passing
            // a cached (or empty) header would make the SDK encrypt the payload.
            metadata.isPublic ? undefined : cachedKeyHeader,
            updateInstructions,
            uploadMetadata,
            payloads,
            undefined, // thumbnails
            toDeletePayloads,
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
     * What a save of a public note does to its card image: upload a new one when its
     * title, excerpt or cover (src or positionY) changed since the last one was drawn,
     * remove it when the new one can't be drawn, else nothing.
     * Where no card can be drawn at all (the MCP server, in Node), an existing card is
     * kept: deleting it would break link previews whose page metadata is still cached.
     */
    async #cardImageChange(
        fileId: string,
        from: CardImageFrom | undefined,
    ): Promise<{ upload?: Blob; remove: boolean; kept?: boolean; keptFrom?: CardImageFrom }> {
        let header: HomebaseFile<NoteFileContent> | null = null;
        try {
            header = await getFileHeader<NoteFileContent>(this.#dotYouClient, JOURNAL_DRIVE, fileId, { decrypt: true });
        } catch (e) {
            console.warn('[NotesDriveProvider] could not read the header for the card image', e);
        }
        if (from && header && isCardImageCurrent(header, from)) return { remove: false };
        const { canRenderCardImage } = await import('@/lib/share/cardImage');
        if (!canRenderCardImage()) {
            const hasCard = !!header?.fileMetadata.payloads?.some((p) => p.key === PAYLOAD_KEY_CARD_IMAGE);
            return hasCard && header ? { remove: false, kept: true, keptFrom: drawnCardImageFrom(header) } : { remove: false };
        }
        const upload = from ? await this.#drawCardImage(fileId, from, (key) => this.#readPayloadBlob(fileId, key, header)) : null;
        if (upload) return { upload, remove: false };
        return { remove: !!header?.fileMetadata.payloads?.some((p) => p.key === PAYLOAD_KEY_CARD_IMAGE) };
    }

    /**
     * Draw the 1200×630 card image of `from`. A cover on another file is left out (the
     * share page won't follow it either). Null when this file's cover can't be read, this
     * browser can't draw it, or drawing fails.
     */
    async #drawCardImage(
        fileId: string,
        from: CardImageFrom,
        readCover: (payloadKey: string) => Promise<Blob | null>,
    ): Promise<Blob | null> {
        const ref = from.cover ? parseAttachmentSrc(from.cover.src, fileId) : null;
        try {
            const { canRenderCardImage, renderCardImage } = await import('@/lib/share/cardImage');
            if (!canRenderCardImage()) return null;
            const image = ref ? await readCover(ref.payloadKey) : null;
            if (ref && !image) return null;
            const text = { title: from.title, excerpt: from.excerpt, author: await this.#authorName() };
            return await renderCardImage(text, image && from.cover ? { image, positionY: from.cover.positionY } : undefined);
        } catch (e) {
            console.warn('[NotesDriveProvider] could not draw the card image', e);
            return null;
        }
    }

    /** The owner's public profile name, as the share page's byline shows it; the identity when there is none. */
    async #authorName(): Promise<string> {
        const identity = this.#dotYouClient.getHostIdentity();
        const card = await GetProfileCard(identity).catch(() => undefined);
        return card?.name || identity;
    }

    /** A payload as a Blob, read with its lastModified so the browser can't hand back a stale copy (#451). */
    async #readPayloadBlob(fileId: string, key: string, header: HomebaseFile<NoteFileContent> | null): Promise<Blob | null> {
        const lastModified = header?.fileMetadata.payloads?.find((p) => p.key === key)?.lastModified;
        const data = await getPayloadBytes(this.#dotYouClient, JOURNAL_DRIVE, fileId, key, { decrypt: true, lastModified });
        return data ? new Blob([new Uint8Array(data.bytes)], { type: data.contentType }) : null;
    }

    /**
     * The card image the share dialog previews for a public note: its uploaded card
     * image when that was drawn from `from`, else the same image drawn here.
     */
    async getCardImage(fileId: string, from: CardImageFrom): Promise<Blob | null> {
        const header = await getFileHeader<NoteFileContent>(this.#dotYouClient, JOURNAL_DRIVE, fileId, { decrypt: true });
        if (header && isCardImageCurrent(header, from)) {
            const uploaded = await this.#readPayloadBlob(fileId, PAYLOAD_KEY_CARD_IMAGE, header);
            if (uploaded) return uploaded;
        }
        return this.#drawCardImage(fileId, from, (key) => this.#readPayloadBlob(fileId, key, header));
    }

    /**
     * Add an image to an existing note using patchFile.
     * Uses uniqueId to look up the file, ensuring consistency with how notes are tracked.
     */
    // Payload keys are max-index-derived (never reused) and encryption/ACL/key
    // header mirror the existing file, so adding an image can't corrupt an image
    // or re-scope the note (was a corruption TODO).
    // `minIndex` is the note's own key counter: the max only sees live payloads, so
    // deleting the top image would hand its key (and its cached picture) out again (#373).
    async addImageToNote(
        uniqueId: string,
        versionTag: string,
        image: ImageUploadData,
        minIndex = 0,
        isRetry = false,
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
        // Derive the next image key from the MAX existing index, not the count:
        // after a deletion (jrnl_img0, jrnl_img2) the count would collide with an
        // existing key and silently overwrite that image.
        const imgKeys = (existingHeader.fileMetadata.payloads ?? [])
            .map(p => p.key)
            .filter(k => k.startsWith(PAYLOAD_KEY_IMAGE_PREFIX));
        const nextIdx = 1 + imgKeys.reduce((max, k) => {
            const n = parseInt(k.slice(PAYLOAD_KEY_IMAGE_PREFIX.length), 10);
            return Number.isFinite(n) ? Math.max(max, n) : max;
        }, minIndex - 1);

        const fileId = existingHeader.fileId;
        const appData = existingHeader.fileMetadata.appData

        const payloadKey = `${PAYLOAD_KEY_IMAGE_PREFIX}${nextIdx}`;
        const { payload, thumbnails } = await buildImagePayload(
            image.file,
            image.filename,
            payloadKey,
            existingHeader.fileMetadata.isEncrypted ? getRandom16ByteArray() : undefined,
            image.naturalSize
        );

        // Mirror the existing file's visibility so adding an image never re-encrypts
        // a public note or strips a collaborative note's circle ACL. Content may come
        // back as a string or an already-parsed object (see makeNotePublic).
        const isEncrypted = existingHeader.fileMetadata.isEncrypted;
        const existingContent: NoteFileContent =
            (typeof appData.content === 'string'
                ? tryJsonParse<NoteFileContent>(appData.content)
                : appData.content) ?? ({} as NoteFileContent);
        const uploadMetadata: UploadFileMetadata = {
            versionTag: existingHeader.fileMetadata.versionTag,
            allowDistribution: false,
            appData: {
                ...appData,
                content: JSON.stringify(existingContent),
            },
            isEncrypted,
            accessControlList: noteAcl(existingContent),
        };

        // UpdateLocalInstructionSet for patchFile
        const updateInstructions: UpdateInstructionSet = {
            locale: 'local',
            file: { fileId, targetDrive: JOURNAL_DRIVE },
            versionTag: existingHeader.fileMetadata.versionTag || versionTag,
        };

        let retried: { versionTag: string; payloadKey: string } | undefined;
        const result = await patchFile(
            this.#dotYouClient,
            // Only an encrypted file has a key header; passing one for a public
            // (unencrypted) note would make the SDK encrypt the payload.
            isEncrypted ? existingHeader.sharedSecretEncryptedKeyHeader : undefined,
            updateInstructions,
            uploadMetadata,
            [payload],
            thumbnails,
            undefined, // toDeletePayloads
            // A content save on this note can land between the header fetch and this
            // patch (#469). Refetch the header and retry once; the patch only adds a
            // new payload and writes back the fresh header's appData, so it can't
            // clobber anything newer.
            isRetry ? undefined : async () => {
                retried = await this.addImageToNote(uniqueId, versionTag, image, minIndex, true);
            }
        );
        if (retried) return retried;

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
     * Fetch a note's header (decrypted), rebuild its UploadFileMetadata and write it
     * back. Shared by every sharing/archival transition so none of them can drop the
     * note's title, tags, date or public flag (#161).
     *
     * - `content` maps the existing (parsed) content to the new content.
     * - `acl`, `isEncrypted` and `groupId` default to the existing header's values.
     * - `ensureEncrypted`: a header-only patch can't encrypt a plaintext payload, so
     *   an unencrypted note is first re-uploaded encrypted via makeNotePrivate and its
     *   header re-fetched.
     * - `fileId`: the note's remote fileId, when known (sync record). The header is read
     *   by fileId first: the server's uniqueId lookup can 404 for a few seconds right
     *   after the note is created (#293). Falls back to the uniqueId lookup.
     */
    async #rewriteNoteHeader(uniqueId: string, spec: {
        fileId?: string;
        mode: 'reupload' | 'patch';
        content: (existing: NoteFileContent) => NoteFileContent | string;
        acl?: AccessControlList;
        isEncrypted?: boolean;
        groupId?: string;
        archivalStatus?: number;
        ensureEncrypted?: boolean;
        /** Reupload only: change the payloads written back. */
        payloads?: (payloads: PayloadFile[], fileId: string) => Promise<PayloadFile[]>;
        errorMessage: string;
    }): Promise<{ versionTag: string; previousVersionTag: string }> {
        const fetchHeader = async () => {
            const header =
                (spec.fileId
                    ? await getFileHeader<NoteFileContent>(
                        this.#dotYouClient,
                        JOURNAL_DRIVE,
                        spec.fileId,
                        { decrypt: true }
                    )
                    : null) ??
                (await getFileHeaderByUniqueId<NoteFileContent>(
                    this.#dotYouClient,
                    JOURNAL_DRIVE,
                    uniqueId,
                    { decrypt: true }
                ));
            if (!header) {
                throw new Error(`Note with uniqueId ${uniqueId} not found`);
            }
            return header;
        };

        let existingHeader = await fetchHeader();
        if (spec.ensureEncrypted && existingHeader.fileMetadata.isEncrypted === false) {
            await this.makeNotePrivate(uniqueId, spec.fileId);
            existingHeader = await fetchHeader();
        }

        const existingAppData = existingHeader.fileMetadata.appData;
        const versionTag = existingHeader.fileMetadata.versionTag;
        const existingContent: NoteFileContent =
            (typeof existingAppData.content === 'string'
                ? tryJsonParse<NoteFileContent>(existingAppData.content)
                : existingAppData.content) ?? ({} as NoteFileContent);
        const newContent = spec.content(existingContent);
        const isEncrypted = spec.isEncrypted ?? existingHeader.fileMetadata.isEncrypted ?? true;

        const uploadMetadata: UploadFileMetadata = {
            versionTag,
            // Peer/feed distribution only — unrelated to the Anonymous ACL that makes
            // a note publicly readable. See FileSystemUpdateWriterBase ("AllowDistribution
            // must be true when UpdateLocale is Peer") and FeedDriveDistributionRouter.
            // A fetched header omits serverMetadata.allowDistribution, so there is
            // nothing to preserve — every local (non-peer) write sends false.
            allowDistribution: false,
            appData: {
                fileType: JOURNAL_FILE_TYPE,
                dataType: JOURNAL_DATA_TYPE,
                uniqueId,
                groupId: spec.groupId ?? existingAppData.groupId,
                userDate: existingAppData.userDate,
                tags: existingAppData.tags,
                content: typeof newContent === 'string' ? newContent : JSON.stringify(newContent),
                archivalStatus: spec.archivalStatus ?? existingAppData.archivalStatus,
            },
            isEncrypted,
            accessControlList: spec.acl ?? existingHeader.serverMetadata?.accessControlList ?? {
                requiredSecurityGroup: SecurityGroupType.Owner,
            },
        };

        let result;
        if (spec.mode === 'reupload') {
            // Full re-upload: re-encrypts (or decrypts) the payloads to match isEncrypted.
            const instructions: UploadInstructionSet = {
                storageOptions: { drive: JOURNAL_DRIVE, overwriteFileId: existingHeader.fileId },
                transferIv: getRandom16ByteArray(),
            };
            const { payloads: existingPayloads, thumbnails } = await this.#readAllPayloads(existingHeader);
            const payloads = spec.payloads ? await spec.payloads(existingPayloads, existingHeader.fileId) : existingPayloads;
            result = await uploadFile(this.#dotYouClient, instructions, uploadMetadata, payloads, thumbnails, isEncrypted);
        } else {
            // Header-only patch — never changes payload encryption.
            const instructions: UpdateInstructionSet = {
                locale: 'local',
                file: { fileId: existingHeader.fileId, targetDrive: JOURNAL_DRIVE },
                versionTag,
            };
            result = await patchFile(
                this.#dotYouClient,
                existingHeader.sharedSecretEncryptedKeyHeader,
                instructions,
                uploadMetadata,
                [],
                undefined
            );
        }

        if (!result) {
            throw new Error(spec.errorMessage);
        }

        return { versionTag: result.newVersionTag, previousVersionTag: versionTag };
    }

    /**
     * Read every payload and thumbnail of a note, for a full re-upload. Not the SDK's
     * reUploadFile: it reads them without lastModified, the only cache-buster on these
     * GETs, and Homebase serves them with a year-long max-age. The browser could then
     * hand back a stale jrnl_txt and the re-upload would overwrite newer edits (#451).
     */
    async #readAllPayloads(header: HomebaseFile<NoteFileContent>): Promise<{ payloads: PayloadFile[]; thumbnails: ThumbnailFile[] }> {
        const payloads: PayloadFile[] = [];
        const thumbnails: ThumbnailFile[] = [];
        for (const { key, contentType, lastModified, thumbnails: thumbs } of header.fileMetadata.payloads ?? []) {
            const data = await getPayloadBytes(this.#dotYouClient, JOURNAL_DRIVE, header.fileId, key, { decrypt: true, lastModified });
            if (!data) continue;
            payloads.push({ key, payload: new Blob([new Uint8Array(data.bytes)], { type: contentType }) });
            for (const { pixelWidth, pixelHeight, contentType: thumbType } of thumbs ?? []) {
                const thumb = await getThumbBytes(this.#dotYouClient, JOURNAL_DRIVE, header.fileId, key, pixelWidth, pixelHeight, { lastModified });
                if (thumb) thumbnails.push({ key, payload: new Blob([new Uint8Array(thumb.bytes)], { type: thumbType }), pixelWidth, pixelHeight });
            }
        }
        return { payloads, thumbnails };
    }

    /**
     * Update a note's access control to make it publicly accessible (Anonymous).
     * This is used for the Share feature.
     * @param uniqueId - The unique ID of the note
     * @param fileId - The note's remote fileId, when known (see #rewriteNoteHeader)
     * @param card - Link-card data to publish in the header (see buildPublicCard)
     * @returns The new version tag, and the one it replaced
     */
    async makeNotePublic(uniqueId: string, fileId?: string, card?: PublicCard): Promise<{ versionTag: string; previousVersionTag: string }> {
        return this.#rewriteNoteHeader(uniqueId, {
            fileId,
            mode: 'reupload',
            // A public note's content is world-readable plaintext; project to a minimal,
            // non-sensitive subset so circleIds/recipients/lastEditedBy never leak.
            content: (existing) => JSON.stringify({
                title: existing.title,
                tags: existing.tags,
                isPublic: true,
                shareDescription: existing.shareDescription,
                shareIndexable: existing.shareIndexable,
                card: card && nonEmptyCard(card),
            }),
            // Draw the card image from the cover bytes this re-upload already read.
            payloads: async (payloads, fileId) => {
                const rest = payloads.filter((p) => p.key !== PAYLOAD_KEY_CARD_IMAGE);
                const from = card?.cardImageFrom;
                const image = from
                    ? await this.#drawCardImage(fileId, from, async (key) => rest.find((p) => p.key === key)?.payload ?? null)
                    : null;
                return image ? [...rest, { key: PAYLOAD_KEY_CARD_IMAGE, payload: image }] : rest;
            },
            isEncrypted: false, // Public notes should not be encrypted
            acl: { requiredSecurityGroup: SecurityGroupType.Anonymous },
            errorMessage: 'Failed to make note public',
        });
    }

    /**
     * Update a note's access control back to private (Owner only).
     * This revokes public sharing.
     *
     * @param uniqueId - The unique ID of the note
     * @param fileId - The note's remote fileId, when known (see #rewriteNoteHeader)
     * @returns The new version tag, and the one it replaced
     */
    async makeNotePrivate(uniqueId: string, fileId?: string): Promise<{ versionTag: string; previousVersionTag: string }> {
        return this.#rewriteNoteHeader(uniqueId, {
            fileId,
            mode: 'reupload',
            // The link card is only meaningful while public; drop it before re-encrypting.
            content: (existing) => {
                const { card: _card, ...rest } = existing as NoteFileContent & { card?: unknown };
                return { ...rest, isPublic: false };
            },
            // ...and its card image with it.
            payloads: async (payloads) => payloads.filter((p) => p.key !== PAYLOAD_KEY_CARD_IMAGE),
            isEncrypted: true, // Private notes should be encrypted
            acl: { requiredSecurityGroup: SecurityGroupType.Owner },
            errorMessage: 'Failed to make note private',
        });
    }

    /**
     * Set a note's Homebase archivalStatus (0 = active, 2 = trashed/Removed).
     * Used for soft delete and restore. Preserves the note's content, encryption
     * and access control.
     *
     * @param uniqueId - The unique ID of the note
     * @param status - 0 to restore, 2 to move to trash
     * @param fileId - The note's remote fileId, when known (see #rewriteNoteHeader)
     * @returns The new version tag after update
     */
    async setNoteArchivalStatus(uniqueId: string, status: number, fileId?: string): Promise<{ versionTag: string }> {
        // Header-only patch — flips archivalStatus without re-uploading payloads
        // (unlike makeNotePublic/Private, this never changes payload encryption).
        return this.#rewriteNoteHeader(uniqueId, {
            fileId,
            mode: 'patch',
            content: (existing) => existing,
            archivalStatus: status,
            errorMessage: 'Failed to update note archival status',
        });
    }

    async dsrToContent<T = NoteFileContent>(dsr: HomebaseFile<unknown>,
        includeMetadataHeader: boolean): Promise<T | null> {
        try {
            // The SDK types appData.content as string; it only forwards the header, so the content type is irrelevant here.
            const noteFileContent = await getContentFromHeaderOrPayload<T>(this.#dotYouClient, JOURNAL_DRIVE, dsr as HomebaseFile, includeMetadataHeader);
            if (!noteFileContent) {
                return null;
            }
            return noteFileContent;
        } catch (error) {
            console.error('[NotesDriveProvider] failed to get the noteFileContent of a dsr', dsr, error);
            return null;

        }
    }
    /**
     * Make a note collaborative, granting access to specified circles.
     * Changes ACL to Connected with circleIds and moves to COLLABORATIVE_FOLDER_ID.
     *
     * @param uniqueId - The unique ID of the note
     * @param circleIds - Array of circle IDs to grant access
     * @param editorOdinId - OdinId of the user making this change
     * @param fileId - The note's remote fileId, when known (see #rewriteNoteHeader)
     * @returns The new version tag after update
     */
    async makeNoteCollaborative(
        uniqueId: string,
        circleIds: string[],
        recipients: string[],
        editorOdinId: string,
        fileId?: string
    ): Promise<{ versionTag: string }> {
        let title = '';
        const result = await this.#rewriteNoteHeader(uniqueId, {
            fileId,
            mode: 'patch',
            content: (existing) => {
                title = existing.title || '';
                return {
                    ...existing,
                    isPublic: false,
                    isCollaborative: true,
                    circleIds,
                    recipients,
                    lastEditedBy: editorOdinId,
                };
            },
            groupId: COLLABORATIVE_FOLDER_ID, // Move to collaborative folder
            isEncrypted: true,
            acl: {
                requiredSecurityGroup: SecurityGroupType.Connected,
                circleIdList: circleIds,
            },
            // Collaborative notes must be encrypted; a public note is re-uploaded
            // encrypted first, since a header-only patch can't encrypt its payload.
            ensureEncrypted: true,
            errorMessage: 'Failed to make note collaborative',
        });

        await this.#invitations.createOrUpdateInvitation(
            uniqueId,
            title,
            '',
            circleIds,
            recipients,
            editorOdinId,
        );

        return result;
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
        const result = await this.#rewriteNoteHeader(uniqueId, {
            mode: 'patch',
            content: (existing) => ({
                ...existing,
                isPublic: false,
                isCollaborative: false,
                circleIds: undefined,
                recipients: undefined,
                lastEditedBy: editorOdinId,
            }),
            groupId: MAIN_FOLDER_ID, // Move back to main folder
            isEncrypted: true, // Private notes should be encrypted
            acl: { requiredSecurityGroup: SecurityGroupType.Owner },
            errorMessage: 'Failed to revoke note collaboration',
        });

        await this.#invitations.deleteInvitation(uniqueId);

        return result;
    }
}
