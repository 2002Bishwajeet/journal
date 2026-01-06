import {
    DotYouClient,
    ApiType,
    getFileHeaderByUniqueId,
    getPayloadBytes,
    getContentFromHeaderOrPayload,
    type HomebaseFile
} from '@homebase-id/js-lib/core';
import { extractMarkdownFromYjs } from '@/lib/utils';
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
     * @param identity - The identity of the note owner
     * @param noteId - The unique ID of the note
     * @returns The shared note data or null if not found/not public
     */
    async getPublicNote(identity: string, noteId: string): Promise<SharedNoteData | null> {
        console.log(`[ShareProvider] Fetching public note: ${identity}/${noteId}`);

        try {
            // Create a client for the target identity
            const client = new DotYouClient({
                hostIdentity: identity,
                api: ApiType.Guest,
            });

            // 1. Try to fetch header directly (Cloud)
            const header: HomebaseFile<unknown> | null = await getFileHeaderByUniqueId(
                client,
                JOURNAL_DRIVE,
                noteId,
            );

            if (!header) {
                console.warn('[ShareProvider] Note not found via direct fetch');
                return null;
            }

            // 3. Get content (metadata like title)
            // getContentFromHeaderOrPayload handles parsing the appData.content
            const content = await getContentFromHeaderOrPayload<NoteFileContent>(
                client,
                JOURNAL_DRIVE,
                header as unknown as HomebaseFile<string>, // Cast to string as appData.content is string
                false // Don't decrypt
            );

            // 4. Get Yjs payload
            const yjsBlob = await getPayloadBytes(
                client,
                JOURNAL_DRIVE,
                header.fileId,
                PAYLOAD_KEY_CONTENT,
                { decrypt: false }
            );

            if (!yjsBlob?.bytes) {
                console.warn('[ShareProvider] Payload not found');
                // Even if payload missing, we might return just title?
                // But for now let's return null or empty content
            }

            // 6. Extract markdown
            const markdown = await extractMarkdownFromYjs(
                noteId, // Pass ID but we are providing blob so it won't use local DB
                yjsBlob?.bytes
            );

            return {
                title: content?.title || 'Untitled',
                content: markdown,
                createdAt: new Date(header.fileMetadata.appData.userDate || Date.now()).toISOString(),
                updatedAt: new Date(header.fileMetadata.transitUpdated || Date.now()).toISOString(),
            };

        } catch (error) {
            console.error('[ShareProvider] Error fetching public note:', error);
            // Return null to trigger 404 state
            return null;
        }
    }

    /**
     * Check if a note is publicly shared.
     */
    async isNotePublic(identity: string, noteId: string): Promise<boolean> {
        // Just try to fetch it
        const note = await this.getPublicNote(identity, noteId);
        return !!note;
    }
}

// Singleton instance
export const shareProvider = new ShareProvider();
