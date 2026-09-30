import type { FolderDriveProvider } from '../FolderDriveProvider';
import type { NotesDriveProvider } from '../NotesDriveProvider';
import type { InboxProcessor } from '../InboxProcessor';

/** What the sync modules need from SyncService; built once in its constructor. */
export interface SyncContext {
    folderProvider: FolderDriveProvider;
    notesProvider: NotesDriveProvider;
    inboxProcessor: InboxProcessor;
    hostIdentity: string;
    /** Calls SyncService.logSyncError on the instance. */
    logSyncError: (
        entityId: string,
        entityType: 'folder' | 'note' | 'image',
        operation: 'push' | 'pull' | 'upload',
        error: unknown,
    ) => Promise<void>;
}
