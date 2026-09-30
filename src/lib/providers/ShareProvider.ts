import {
    DotYouClient,
    ApiType,
    getFileHeaderByUniqueId,
    getPayloadBytes,
    getContentFromHeaderOrPayload,
    type HomebaseFile,
} from '@homebase-id/js-lib/core';
import { extractMarkdownFromYjs } from '@/lib/yjs-utils';
import { getCoverFromBlob } from '@/lib/editor/cover';
import { parseAttachmentSrc } from '@/lib/utils/attachmentSrc';
import type { NoteFileContent } from '@/types';
import { JOURNAL_DRIVE, PAYLOAD_KEY_CONTENT } from '@/lib/homebase/config';

export interface SharedNoteData {
    title: string;
    content: string; // Markdown
    fileId: string;
    /** Uploaded cover image of this note (never a ref to another file). */
    cover?: { src: string; positionY: number };
    createdAt: string;
    updatedAt: string;
}

export class ShareProvider {
    /**
     * Fetch a publicly shared note.
     *
     * The note is read anonymously from the author's Guest API. The backend's CORS
     * policy echoes the request origin and sets Access-Control-Allow-Credentials, so
     * the SDK's guest client works cross-origin, and a logged-out caller is
     * authenticated as SecurityGroupType.Anonymous. Public notes are unencrypted, so
     * everything is fetched with decrypt:false.
     *
     * @param identity - The identity of the note owner
     * @param noteId - The unique ID of the note
     * @returns The shared note data, or null if not found / offline
     * @throws if the note exists but is not publicly shared (401/403)
     */
    async getPublicNote(identity: string, noteId: string): Promise<SharedNoteData | null> {
        const client = new DotYouClient({ hostIdentity: identity, api: ApiType.Guest });

        let header: HomebaseFile<NoteFileContent> | null;
        try {
            header = await getFileHeaderByUniqueId<NoteFileContent>(
                client,
                JOURNAL_DRIVE,
                noteId,
                { decrypt: false }
            );
        } catch (err) {
            // The SDK returns null for a 404; a 401/403 means the note exists but
            // isn't publicly shared.
            const status = (err as { response?: { status?: number } })?.response?.status;
            if (status === 401 || status === 403) {
                // Tagged so the query hook can skip retrying a definitive result.
                const forbidden = new Error('This note is not shared publicly.') as Error & {
                    isForbidden?: boolean;
                };
                forbidden.isForbidden = true;
                throw forbidden;
            }
            console.error('[ShareProvider] Failed to fetch shared note header:', err);
            return null;
        }

        if (!header?.fileId) return null;

        // A trashed note (archivalStatus 2) keeps its Anonymous ACL, so the guest
        // fetch still succeeds — but a shared link must not serve a trashed note.
        if (header.fileMetadata?.appData?.archivalStatus === 2) return null;

        // Title and other metadata live in appData.content (plaintext for public notes).
        const content = await getContentFromHeaderOrPayload<NoteFileContent>(
            client,
            JOURNAL_DRIVE,
            header as unknown as HomebaseFile<string>,
            false // don't decrypt
        );
        const title = content?.title || 'Untitled';

        // A missing payload is not fatal — render the titled note with an empty body.
        let markdown = '';
        let cover: SharedNoteData['cover'];
        try {
            const yjs = await getPayloadBytes(client, JOURNAL_DRIVE, header.fileId, PAYLOAD_KEY_CONTENT, {
                decrypt: false,
            });
            if (yjs?.bytes && yjs.bytes.length > 0) {
                markdown = await extractMarkdownFromYjs(noteId, yjs.bytes);
                const c = getCoverFromBlob(yjs.bytes);
                if (c && parseAttachmentSrc(c.src, header.fileId)) {
                    cover = { src: c.src, positionY: c.positionY };
                }
            }
        } catch (err) {
            console.warn('[ShareProvider] Failed to fetch shared note payload:', err);
        }

        return {
            title,
            content: markdown,
            fileId: header.fileId,
            ...(cover ? { cover } : {}),
            createdAt: new Date(header.fileMetadata.appData.userDate || Date.now()).toISOString(),
            // `updated` is the file's modified time; `transitUpdated` is only set for
            // files received over transit, never for the owner's own notes.
            updatedAt: new Date(
                header.fileMetadata.updated || header.fileMetadata.appData.userDate || Date.now()
            ).toISOString(),
        };
    }

    /**
     * Check if a note is publicly shared.
     */
    async isNotePublic(identity: string, noteId: string): Promise<boolean> {
        try {
            return !!(await this.getPublicNote(identity, noteId));
        } catch {
            return false;
        }
    }
}

// Singleton instance
export const shareProvider = new ShareProvider();
