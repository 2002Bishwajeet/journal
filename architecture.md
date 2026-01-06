# Journal App Architecture

## Overview

Local-first, encrypted markdown notes app built with React + TypeScript. Uses PGlite (SQLite in browser via WASM) for local storage with bidirectional sync to Homebase (personal encrypted cloud).

## Tech Stack

- **Framework**: React 18 + Vite + TypeScript
- **Local DB**: PGlite (SQLite WASM)
- **Editor**: TipTap (rich text) + Yjs (CRDT)
- **Cloud Sync**: Homebase SDK
- **AI**: WebLLM (on-device)
- **Styling**: Tailwind CSS + shadcn/ui

---

## Directory Structure

```
src/
├── components/          # React components
│   ├── auth/           # Login, OAuth callback
│   ├── editor/         # TipTap editor, toolbar
│   ├── layout/         # Sidebar, folder tree
│   ├── modals/         # Dialogs (settings, export)
│   └── ui/             # shadcn primitives
├── hooks/              # React hooks
│   ├── auth/           # useAuth, useYouAuthAuthorization
│   ├── mutations/      # useNoteMutations, useFolderMutations
│   ├── queries/        # useNotes, useFolders
│   └── useSyncService  # Homebase sync orchestration
├── lib/                # Core logic
│   ├── db/             # PGlite database + queries
│   ├── homebase/       # Sync engine (providers + service)
│   ├── yjs/            # Yjs persistence provider
│   ├── webllm/         # AI engine wrapper
│   └── workers/        # Web Workers
├── pages/              # Route pages
├── types/              # TypeScript types
└── layouts/            # Page layouts
```

---

## Data Flow

```mermaid
graph TB
    subgraph Browser
        UI[React UI] --> Hooks[Hooks]
        Hooks --> DB[(PGlite)]
        Hooks --> Yjs[Yjs Doc]
        Yjs --> DB
    end
    
    subgraph Sync
        DB --> SyncService[SyncService]
        SyncService --> HB[Homebase Cloud]
        HB --> SyncService
        SyncService --> DB
    end
```

---

## Key Modules

### Database (`lib/db/`)
| File | Purpose |
|------|---------|
| `pglite.ts` | PGlite initialization, schema migrations |
| `queries.ts` | All SQL operations (notes, folders, sync records) |

### Homebase Sync (`lib/homebase/`)
| File | Purpose |
|------|---------|
| `config.ts` | Drive identifiers, file types |
| `NotesDriveProvider.ts` | Note CRUD + image uploads (uses `patchFile`) |
| `FolderDriveProvider.ts` | Folder CRUD (uses `patchFile`) |
| `SyncService.ts` | Bidirectional sync orchestration |
| `InboxProcessor.ts` | Fetch remote changes via `queryBatch` |

### Hooks (`hooks/`)
| File | Purpose |
|------|---------|
| `useSyncService.ts` | Auto-sync, offline detection, retry logic |
| `useJournalState.ts` | Global app state, logout handler |
| `useWebLLM.ts` | AI model loading + inference |

---

## Sync Architecture

### Overview

The sync engine implements bidirectional synchronization between local PGlite database and Homebase cloud storage. It follows **local-first** principles: all writes hit local DB immediately, then sync in background.

```mermaid
flowchart TB
    subgraph Local["🖥️ Browser"]
        UI["React UI"] --> Hooks["Mutation Hooks"]
        Hooks --> PGlite[("PGlite DB")]
        Hooks --> YjsDoc["Yjs Document"]
        YjsDoc --> PGlite
        PGlite --> SyncRecords[("sync_records")]
    end
    
    subgraph SyncLayer["⚡ Sync Layer"]
        SyncRecords --> SyncService["SyncService"]
        SyncService --> Push["pushNote / pushFolder"]
        SyncService --> Pull["InboxProcessor"]
    end
    
    subgraph Cloud["☁️ Homebase"]
        Push --> Drive[("Encrypted Drive")]
        Drive --> Pull
    end
    
    Pull --> PGlite
```

---

### Sync Record Lifecycle

Every local change creates a `sync_record` entry that tracks sync state:

```mermaid
stateDiagram-v2
    [*] --> pending: Local change
    pending --> synced: Push success
    pending --> error: Push failed
    error --> pending: Retry
    synced --> pending: New local edit
    synced --> [*]: Cleanup
```

**States:**
| State | Meaning |
|-------|---------|
| `pending` | Needs to be pushed to Homebase |
| `synced` | Successfully synced |
| `error` | Push failed, will retry |

---

### Push Flow (Local → Remote)

When user edits a note locally:

```mermaid
sequenceDiagram
    participant UI as React UI
    participant Hook as useNoteMutations
    participant DB as PGlite
    participant Sync as SyncService
    participant HB as Homebase

    UI->>Hook: updateNote(id, content)
    Hook->>DB: UPDATE documents
    Hook->>DB: INSERT sync_records (pending)
    Hook-->>UI: Optimistic update
    
    Note over Sync: Background sync tick
    Sync->>DB: SELECT pending sync_records
    Sync->>Sync: Get Yjs state from document_updates
    Sync->>HB: patchFile(fileId, yjsBlob, metadata)
    HB-->>Sync: { versionTag }
    Sync->>DB: UPDATE sync_records (synced)
    Sync->>DB: UPDATE notes SET remote_file_id, remote_version_tag
```

---

### Pull Flow (Remote → Local)

When changes exist on remote:

```mermaid
sequenceDiagram
    participant Sync as SyncService
    participant Inbox as InboxProcessor
    participant HB as Homebase
    participant DB as PGlite
    participant Yjs as Yjs Merge

    Note over Sync: Sync tick
    Sync->>Inbox: fetchRemoteChanges()
    Inbox->>HB: queryBatch(modifiedSince)
    HB-->>Inbox: [files with versionTag > local]
    
    loop Each changed file
        Inbox->>HB: getPayloadBytes(fileId, 'jrnl_txt')
        HB-->>Inbox: remoteYjsBlob
        Inbox->>DB: SELECT yjsBlob FROM document_updates
        Inbox->>Yjs: merge(localYjs, remoteYjs)
        Yjs-->>Inbox: mergedYjs
        Inbox->>DB: UPDATE document_updates
        Inbox->>DB: UPDATE notes (metadata, versionTag)
    end
```

---

### Yjs CRDT Merge

Content conflicts are resolved using Yjs CRDT (Conflict-free Replicated Data Type):

```mermaid
flowchart LR
    A["Device A: Added 'Hello'"] --> Merge["Yjs.mergeUpdates()"]
    B["Device B: Added 'World'"] --> Merge
    Merge --> Result["Result: 'Hello World'"]
```

**Key insight:** Yjs preserves all operations from both sides, ordering by logical timestamps. No data is ever lost.

---

### Offline & Retry

```mermaid
flowchart TD
    Start["Sync Tick"] --> Online{"navigator.onLine?"}
    Online -->|No| Skip["Skip sync, show offline"]
    Online -->|Yes| Push["Push pending changes"]
    Push --> Success{"Success?"}
    Success -->|Yes| Pull["Pull remote changes"]
    Success -->|No| Retry["Schedule retry (5s backoff)"]
    Pull --> Done["Update UI: synced"]
    Retry --> Done
```

**Auto-reconnection:**
```typescript
window.addEventListener('online', () => {
    sync(); // Immediately sync when back online
});
```

---

### Component Interactions

```mermaid
flowchart TB
    subgraph Hooks
        useSyncService["useSyncService()"]
        useNoteMutations["useNoteMutations()"]
        useFolderMutations["useFolderMutations()"]
    end
    
    subgraph Services
        SyncService["SyncService"]
        NotesDriveProvider["NotesDriveProvider"]
        FolderDriveProvider["FolderDriveProvider"]
        InboxProcessor["InboxProcessor"]
    end
    
    subgraph Storage
        PGlite[("PGlite")]
        Homebase[("Homebase Drive")]
    end
    
    useSyncService --> SyncService
    useNoteMutations --> PGlite
    useFolderMutations --> PGlite
    
    SyncService --> NotesDriveProvider
    SyncService --> FolderDriveProvider
    SyncService --> InboxProcessor
    
    NotesDriveProvider --> Homebase
    FolderDriveProvider --> Homebase
    InboxProcessor --> Homebase
    
    SyncService --> PGlite
    InboxProcessor --> PGlite
```

---

### Database Tables for Sync

```sql
-- Tracks what needs to sync
CREATE TABLE sync_records (
    id TEXT PRIMARY KEY,
    entity_type TEXT,        -- 'note' | 'folder'
    entity_id TEXT,
    sync_status TEXT,        -- 'pending' | 'synced' | 'error'
    remote_file_id TEXT,
    remote_version_tag TEXT,
    last_sync_attempt INTEGER,
    error_message TEXT
);

-- Tracks pending image uploads
CREATE TABLE pending_image_uploads (
    id TEXT PRIMARY KEY,
    note_id TEXT,
    image_blob BLOB,
    filename TEXT,
    created_at INTEGER
);
```

---

## File Type Constants

| Type | fileType | dataType |
|------|----------|----------|
| Note | 605 | 706 |
| Folder | 606 | 707 |

**Payload keys:**
- `jrnl_txt` - Yjs content blob (binary, `application/octet-stream`)
- `jrnl_img0..N` - Image payloads with thumbnails

---

## Security

- **Encryption**: All Homebase files encrypted with owner key
- **ACL**: `SecurityGroupType.Owner` (private to user)
- **Local**: PGlite data stored in browser IndexedDB
- **Logout**: Calls `clearAllLocalData()` to wipe all local data

