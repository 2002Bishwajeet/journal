import {
    DotYouClient,
    ApiType,
    getFileHeaderByUniqueId,
    getPayloadBytes,
    getContentFromHeaderOrPayload,
    type HomebaseFile,
} from '@homebase-id/js-lib/core';
import * as Y from 'yjs';
import { extractMarkdownFromYjs } from '@/lib/yjs-utils';
import { getCover } from '@/lib/editor/cover';
import { getBlockStates } from '@/lib/liveBlockState';
import { parseAttachmentSrc } from '@/lib/utils/attachmentSrc';
import type { NoteFileContent } from '@/types';
import { JOURNAL_DRIVE, PAYLOAD_KEY_CONTENT } from '@/lib/homebase/config';
import { httpStatus } from '@/lib/homebase/httpStatus';

export interface SharedNoteData {
    title: string;
    content: string; // Markdown
    fileId: string;
    /** Uploaded cover image of this note (never a ref to another file). */
    cover?: { src: string; positionY: number };
    /** Saved state of the note's html and react blocks (#410), as JSON text per block id. */
    blockStates?: Record<string, string>;
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

        let header: HomebaseFile | null;
        try {
            header = await getFileHeaderByUniqueId(
                client,
                JOURNAL_DRIVE,
                noteId,
                { decrypt: false }
            );
        } catch (err) {
            // The SDK returns null for a 404; a 401/403 means the note exists but
            // isn't publicly shared.
            const status = httpStatus(err);
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
            header,
            false // don't decrypt
        );
        const title = content?.title || 'Untitled';

        // A missing payload is not fatal — render the titled note with an empty body.
        let markdown = '';
        let cover: SharedNoteData['cover'];
        let blockStates: SharedNoteData['blockStates'];
        try {
            const yjs = await getPayloadBytes(client, JOURNAL_DRIVE, header.fileId, PAYLOAD_KEY_CONTENT, {
                decrypt: false,
            });
            if (yjs?.bytes && yjs.bytes.length > 0) {
                // Decode once; markdown, cover and block states all read from this doc.
                const ydoc = new Y.Doc();
                try {
                    try {
                        Y.applyUpdate(ydoc, yjs.bytes);
                    } catch (err) {
                        // A broken blob leaves the doc empty: no markdown, cover or block states.
                        console.warn('[ShareProvider] Failed to decode shared note payload:', err);
                    }
                    markdown = await extractMarkdownFromYjs(noteId, ydoc);
                    const c = getCover(ydoc);
                    if (c && parseAttachmentSrc(c.src, header.fileId)) {
                        cover = { src: c.src, positionY: c.positionY };
                    }
                    blockStates = getBlockStates(ydoc);
                } finally {
                    ydoc.destroy();
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
            ...(blockStates && Object.keys(blockStates).length > 0 ? { blockStates } : {}),
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
