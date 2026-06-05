import {
    DotYouClient,
    ApiType,
    getFileHeaderByUniqueId,
    getPayloadBytes,
    getContentFromHeaderOrPayload,
    type HomebaseFile,
} from '@homebase-id/js-lib/core';
import { extractMarkdownFromYjs } from '@/lib/yjs-utils';
import type { NoteFileContent } from '@/types';
import { JOURNAL_DRIVE, PAYLOAD_KEY_CONTENT } from '@/lib/homebase/config';

export interface SharedNoteData {
    title: string;
    content: string; // Markdown
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
        try {
            const yjs = await getPayloadBytes(client, JOURNAL_DRIVE, header.fileId, PAYLOAD_KEY_CONTENT, {
                decrypt: false,
            });
            if (yjs?.bytes && yjs.bytes.length > 0) {
                markdown = await extractMarkdownFromYjs(noteId, yjs.bytes);
            }
        } catch (err) {
            console.warn('[ShareProvider] Failed to fetch shared note payload:', err);
        }

        return {
            title,
            content: markdown,
            createdAt: new Date(header.fileMetadata.appData.userDate || Date.now()).toISOString(),
            updatedAt: new Date(header.fileMetadata.transitUpdated || Date.now()).toISOString(),
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
