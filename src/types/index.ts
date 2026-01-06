// Document types for the Journal app

export interface DocumentMetadata {
    title: string;
    folderId: string; // 'main'  UUID
    tags: string[];
    timestamps: {
        created: string;
        modified: string;
    };
    excludeFromAI: boolean;
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
    vectorEmbedding?: number[];
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
}

// Homebase specific types
export interface HomebaseNote {
    fileId?: string;
    globalTransitId?: string;
    metadata: DocumentMetadata;
    payloads: {
        content?: string; // payloadKey for Yjs blob
        images?: string[]; // payloadKeys for images
        linkPreviews?: string[]; // payloadKeys for link previews
    };
}

// Folder file content stored in Homebase
export interface FolderFile {
    name: string;
    isCollaborative: boolean; // V2 placeholder
    needsPassword: boolean;   // V2 placeholder
    color?: string;
}

// Note file content stored in Homebase header
// folderId is stored as groupId in Homebase, not in content
export interface NoteFileContent {
    title: string;
    tags: string[];
    excludeFromAI: boolean;
    isCollaborative?: boolean;
}

// Sync tracking for local ↔ remote mapping
export interface SyncRecord {
    localId: string;
    entityType: 'folder' | 'note';
    remoteFileId?: string;
    versionTag?: string;
    lastSyncedAt?: string;
    syncStatus: 'pending' | 'synced' | 'conflict' | 'error';
    contentHash?: string;
}

// Image pending upload for retry queue
export interface PendingImageUpload {
    id: string;
    noteDocId: string;
    blobData: Uint8Array;
    contentType: string;
    status: 'pending' | 'uploading' | 'failed';
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

// Progress tracking for sync operations
export interface SyncProgress {
    phase: 'pull' | 'push' | 'images';
    current: number;
    total: number;
    message?: string;
}
