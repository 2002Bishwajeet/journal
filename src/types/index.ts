import type { FolderCard } from '@/lib/share/folderCard';

export interface DocumentMetadata {
    title: string;
    folderId: string; // 'main'  UUID
    tags?: string[];
    timestamps: {
        created: string;
        modified: string;
    };
    excludeFromAI: boolean;
    isPinned?: boolean;
    isPublic?: boolean;      // Shared via public link (ACL = Anonymous)
    shareDescription?: string; // Owner override for the public link-card description
    shareIndexable?: boolean;  // Owner opt-in: allow search engines to index the public note
    shareUnlisted?: boolean;   // Public by link only: left off the author page, folder page and sitemap
    linkedNoteIds?: string[]; // docIds this note links to via [[ internal links (powers backlinks)
    archivalStatus?: number; // Homebase ArchivalStatus: 0 active, 2 trashed (Removed)
    // Collaboration fields
    isCollaborative?: boolean;
    circleIds?: string[];    // Circles granted access (multiple): their members are editors
    // People named on the share, lowercased: viewers, who can read but not edit (#897). Person
    // editors (#736) would be a list of their own, so a stored note never changes meaning.
    odinIds?: string[];
    recipients?: string[];   // OdinIds of collaborators (from circle members)
    lastEditedBy?: string;   // OdinId of last editor
    authorOdinId?: string;     // Identity that owns the note (for peer fetch)
}

export interface Document {
    id: string;
    metadata: DocumentMetadata;
}

export interface DocumentUpdate {
    docId: string;
    updateBlob: Uint8Array;
    createdAt: Date;
}

export interface SearchIndexEntry {
    docId: string;
    title: string;
    plainTextContent: string;
    metadata: DocumentMetadata;
}

/** Lightweight version for list rendering — no full content */
export interface NoteListEntry {
    docId: string;
    title: string;
    preview: string; // first ~150 chars of content
    metadata: DocumentMetadata;
}

// Enhanced search result with match highlighting
export interface AdvancedSearchResult {
    docId: string;
    title: string;
    metadata: DocumentMetadata;
    matchType: 'title' | 'content' | 'fuzzy' | 'semantic';
    score: number;
    /** Highlighted title snippet with <mark> tags if title matched */
    titleHighlight?: string;
    /** Highlighted content snippet with <mark> tags showing match context */
    contentHighlight?: string;
}

export interface Folder {
    id: string;
    name: string;
    createdAt: Date;
    isPublic?: boolean; // Shared folder: every note in it is public (#618)
}


// Folder file content stored in Homebase
export interface FolderFile {
    name: string;
    isCollaborative: boolean; // V2 placeholder
    needsPassword: boolean;   // V2 placeholder
    color?: string;
    isPublic?: boolean;       // Shared folder: stored unencrypted with an Anonymous ACL (#618)
    card?: FolderCard;        // Its link card image payload and what it was drawn from (#644)
}

// Note file content stored in Homebase header
// folderId is stored as groupId in Homebase, not in content
export interface NoteFileContent {
    title: string;
    tags: string[];
    excludeFromAI: boolean;
    isPinned?: boolean;
    isPublic?: boolean;      // Shared via public link (ACL = Anonymous)
    shareDescription?: string;
    shareIndexable?: boolean;
    shareUnlisted?: boolean;
    // Collaboration fields
    isCollaborative?: boolean;
    circleIds?: string[];
    odinIds?: string[];      // Named viewers (#897)
    recipients?: string[];   // OdinIds of collaborators (from circle members)
    lastEditedBy?: string;
}

export interface CollaborationInviteContent {
    authorOdinId: string;
    noteUniqueId: string;
    noteTitle: string;
    notePreview: string;
    sharedAt: string;
}

// Sync tracking for local ↔ remote mapping
export interface SyncRecord {
    localId: string;
    entityType: 'folder' | 'note';
    remoteFileId?: string;
    versionTag?: string;
    lastSyncedAt?: string;
    syncStatus: 'pending' | 'synced' | 'conflict' | 'error' | 'pending_delete';
    contentHash?: string;
    encryptedKeyHeader?: string;
    authorOdinId?: string;
    globalTransitId?: string;
    dirtyGeneration?: number;
}

// Image pending upload for retry queue
export interface PendingImageUpload {
    id: string;
    noteDocId: string;
    blobData: Uint8Array;
    contentType: string;
    status: 'pending' | 'uploading' | 'failed' | 'failed_permanent' | 'discarded' | 'synced';
    retryCount: number;
    payloadKey?: string; // Set after successful upload
    createdAt: string;
}

// App state types
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface AppState {
    isAuthenticated: boolean;
    identity?: string;
    syncStatus: SyncStatus;
    lastSyncAt?: Date;
}

// Sync error tracking
export interface SyncError {
    id?: number;
    entityId: string;
    entityType: 'folder' | 'note' | 'image';
    operation: 'push' | 'pull' | 'upload';
    errorMessage: string;
    errorCode?: string;
    retryCount: number;
    nextRetryAt?: string;
    createdAt: string;
    resolvedAt?: string;
}

// Version history snapshot, without its blobs (#158)
export interface SnapshotMeta {
    id: number;
    preview: string;
    wordCount: number;
    createdAt: Date;
}

// Progress tracking for sync operations
export interface SyncProgress {
    phase: 'pull' | 'push' | 'images';
    current: number;
    total: number;
    message?: string;
}
