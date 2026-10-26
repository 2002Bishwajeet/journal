import type { FolderDriveProvider } from '../FolderDriveProvider';
import type { NotesDriveProvider } from '../NotesDriveProvider';
import type { InboxProcessor } from '../InboxProcessor';
import type { SyncErrorInfo } from './syncErrorInfo';

/** What the sync modules need from SyncService; built once in its constructor. */
export interface SyncContext {
    folderProvider: FolderDriveProvider;
    notesProvider: NotesDriveProvider;
    inboxProcessor: InboxProcessor;
    hostIdentity: string;
    /**
     * Per note: remote headers last updated at or before this time predate a header
     * rewrite this device made (a revoke), so their metadata must not overwrite it (#689).
     */
    supersededNoteHeaders: Map<string, number>;
    /** Calls SyncService.logSyncError on the instance. */
    logSyncError: (
        entityId: string,
        entityType: 'folder' | 'note' | 'image',
        operation: 'push' | 'pull' | 'upload',
        error: unknown,
    ) => Promise<SyncErrorInfo>;
}
