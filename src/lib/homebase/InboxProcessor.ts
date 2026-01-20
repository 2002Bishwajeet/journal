import {
    queryBatch,
    type DotYouClient,
    type HomebaseFile,
    type DeletedHomebaseFile,
    type QueryBatchResponse,
} from '@homebase-id/js-lib/core';
import { getQueryBatchCursorFromTime } from '@homebase-id/js-lib/helpers';
import {
    JOURNAL_DRIVE,
    JOURNAL_FILE_TYPE,
    FOLDER_FILE_TYPE,
} from './config';
import type { FolderFile, NoteFileContent } from '@/types';

const BATCH_SIZE = 500;
const BUFFER_MS = 15 * 60 * 1000; // 15 minutes buffer to handle clock skew

export interface InboxProcessResult {
    folders: (HomebaseFile<FolderFile> | DeletedHomebaseFile)[];
    notes: (HomebaseFile<NoteFileContent> | DeletedHomebaseFile)[];
}

/**
 * InboxProcessor fetches all changes from Homebase since the last sync time.
 * Uses queryBatch with cursor-based pagination to efficiently fetch updates.
 * Pattern inspired by community inbox processor.
 */
export class InboxProcessor {
    #dotYouClient: DotYouClient;

    constructor(dotYouClient: DotYouClient) {
        this.#dotYouClient = dotYouClient;
    }

    /**
     * Process changes since last sync time.
     * @param lastSyncTime - Unix timestamp of last successful sync (ms)
     * @returns All folder and note changes (including deletions)
     */
    async processChanges(lastSyncTime?: number): Promise<InboxProcessResult> {
        // Add buffer to account for clock skew and ensure we don't miss changes
        const sinceTime = lastSyncTime ? lastSyncTime - BUFFER_MS : undefined;

        // process both at the same time. not much changes while we are offline.
        const results = await this.findChangesSince(
            [FOLDER_FILE_TYPE, JOURNAL_FILE_TYPE],
            sinceTime,
        );

        // Process and separate folder and note changes
        const folders: (HomebaseFile<FolderFile> | DeletedHomebaseFile)[] = [];
        const notes: (HomebaseFile<NoteFileContent> | DeletedHomebaseFile)[] = [];
        const yieldEvery = 500;

        for (let index = 0; index < results.length; index += 1) {
            const item = results[index];
            const fileType = item.fileMetadata.appData.fileType;

            if (fileType === FOLDER_FILE_TYPE) {
                folders.push(item as HomebaseFile<FolderFile> | DeletedHomebaseFile);
            } else if (fileType === JOURNAL_FILE_TYPE) {
                notes.push(item as HomebaseFile<NoteFileContent> | DeletedHomebaseFile);
            }

            if (index % yieldEvery === 0) {
                await this.yieldToMainThread();
            }
        }

        return {
            folders,
            notes,
        };
    }

    /**
     * Find all files changed since a timestamp.
     * Uses queryBatch with cursor-based pagination to fetch ALL changes.
     */
    async findChangesSince(
        fileTypes: number[],
        timestamp?: number
    ): Promise<(HomebaseFile | DeletedHomebaseFile)[]> {
        // Generate initial cursor from timestamp range
        // For initial sync (timestamp = 0), we use 1ms (epoch start) to ensure
        // ALL files are fetched from the beginning of time
        let cursor: string | undefined = getQueryBatchCursorFromTime(
            new Date().getTime(),
            timestamp
        );

        const allResults: (HomebaseFile | DeletedHomebaseFile)[] = [];

        // Paginate through all results
        while (true) {
            const response: QueryBatchResponse = await queryBatch(this.#dotYouClient, {
                targetDrive: JOURNAL_DRIVE,
                fileType: fileTypes,
                fileState: [0, 1], // 0 = active, 1 = deleted
            }, {
                maxRecords: BATCH_SIZE,
                cursorState: cursor,
                includeMetadataHeader: true,
                includeTransferHistory: false,
                ordering: 'newestFirst',
                sorting: 'anyChangeDate',
            }, {
                decrypt: true,
            });

            allResults.push(...response.searchResults);

            // Check if there are more results
            if (response.searchResults.length < BATCH_SIZE || !response.cursorState) {
                break; // No more pages
            }

            cursor = response.cursorState;
        }

        return allResults;
    }

    private async yieldToMainThread(): Promise<void> {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    /**
     * Get current time for saving as last sync timestamp.
     */
    getCurrentSyncTime(): number {
        return Date.now();
    }
}
