# Note Archiving Feature Design

**Date:** April 18, 2026  
**Status:** Design Specification  
**Author:** Claude Code Analysis  
**Project:** Journal App (React + TipTap + PGlite + Homebase SDK)

---

## Executive Summary

This document specifies the design for adding a note archiving feature to the Journal app. Archiving allows users to hide completed, old, or inactive notes from the main note list without permanently deleting them. The design is tailored to the codebase's existing architecture using PGlite for local storage, Homebase SDK for remote sync, and Yjs for CRDT-based collaboration.

**Key Design Decisions:**
- **Storage:** `isArchived` boolean in `DocumentMetadata` (alongside `isPinned`)
- **Filtering:** Client-side in React queries + SQL WHERE clause for efficient filtering
- **Sync:** Archived state propagates via metadata changes through existing SyncService
- **UI:** Archive section in Sidebar (toggleable like folders), plus context menu/swipe actions
- **Deletion:** Soft-delete pattern already exists (hard deletes via `deleteSearchIndexEntry`); archiving is a middle ground
- **Database:** No new tables; migration adds `isArchived` field via metadata index

---

## 1. Current Architecture Analysis

### 1.1 Note Storage Model

**Metadata Structure (`src/types/index.ts`):**
```typescript
export interface DocumentMetadata {
    title: string;
    folderId: string;           // 'main' or UUID
    tags: string[];
    timestamps: { created: string; modified: string };
    excludeFromAI: boolean;
    isPinned?: boolean;         // Existing pattern for metadata flags
    isCollaborative?: boolean;
    circleIds?: string[];
    recipients?: string[];
    lastEditedBy?: string;
}
```

**Database Storage:**
- **Primary:** `search_index.metadata` (JSONB column)
- **Indexed via migration:** `idx_search_metadata_folderid` on `metadata->>'folderId'`
- Metadata is stored as JSON and parsed when queried

**Key Tables:**
- `search_index`: Denormalized note metadata + preview (source of truth for UI)
- `document_updates`: Yjs binary blobs (from Homebase pull)
- `sync_records`: Local ↔ remote mapping

### 1.2 Current Deletion Behavior

**Hard Delete Flow (`src/hooks/useNotes.ts`):**
```typescript
const deleteNoteMutation = useMutation<void, Error, string>({
    mutationFn: async (docId: string) => {
        await deleteNoteRemote(docId);       // Pushes deletion to Homebase
        await deleteSearchIndexEntry(docId);  // Removes from search_index
        await deleteDocumentUpdates(docId);   // Clears Yjs updates
        await deleteSyncRecord(docId);        // Removes sync tracking
    }
});
```

**Observations:**
1. No soft-delete currently exists (no `deleted_at` or similar column)
2. Deletion is immediate and cascades across all tables
3. Remote deletion via Homebase is coordinated first
4. Perfect opportunity for archiving to use similar infrastructure

### 1.3 Sync Architecture

**SyncService Flow (`src/lib/homebase/SyncService.ts`):**
1. **Pull:** InboxProcessor fetches remote changes → `handleRemoteNote()` merges metadata
2. **Push:** `pushNote()` detects pending sync records → uploads to Homebase
3. **Metadata Changes:** Tracked via `updateSyncStatus(docId, 'pending')`

**Key Pattern:**
- Metadata changes (title, pin, tags) trigger `updateSearchIndexMetadata()`
- This auto-updates sync status to 'pending'
- Next sync cycle pushes the metadata change to Homebase

**NoteFileContent (Homebase):**
```typescript
export interface NoteFileContent {
    title: string;
    tags: string[];
    excludeFromAI: boolean;
    isPinned?: boolean;
    // ... collaboration fields
    // NOTE: isArchived will be added here too
}
```

### 1.4 Note Listing & Filtering

**Query Pattern (`src/lib/db/queries.ts`):**
```typescript
export async function getNotesForList(): Promise<NoteListEntry[]> {
    const result = await db.query(`
        SELECT doc_id, title, LEFT(plain_text_content, 150) as preview, metadata
        FROM search_index
        ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST
    `);
    // ... process and return
}
```

**Observations:**
1. All queries return active notes only (no filtering)
2. Filtering by folder exists: `getNotesForListByFolder(folderId: string)`
3. No existing "archived" or "deleted" filter
4. Frontend does grouping by date (Today, Yesterday, This Week, etc.)

### 1.5 Sidebar Folder Structure

**Current Sidebar (`src/components/layout/Sidebar.tsx`):**
- Shows all folders from `folders` table
- Folder creation/deletion supported
- No special "Archive" or "Trash" folder

**Recommendation:** Add "Archive" as a pseudo-section in the sidebar, not a real folder, since archive is a global flag, not a location.

---

## 2. Proposed Design: Note Archiving

### 2.1 Metadata Field Addition

**Updated `DocumentMetadata` interface:**
```typescript
export interface DocumentMetadata {
    title: string;
    folderId: string;
    tags: string[];
    timestamps: { created: string; modified: string };
    excludeFromAI: boolean;
    isPinned?: boolean;
    isArchived?: boolean;       // NEW: defaults to false if missing
    // ... other fields unchanged
}
```

**Rationale:**
- Follows existing pattern (same as `isPinned`)
- Optional field for backward compatibility
- Stored in JSONB metadata column (no schema change needed)
- Syncs automatically via existing metadata change flow

**Updated `NoteFileContent` (for Homebase):**
```typescript
export interface NoteFileContent {
    title: string;
    tags: string[];
    excludeFromAI: boolean;
    isPinned?: boolean;
    isArchived?: boolean;       // NEW
    // ... collaboration fields
}
```

### 2.2 Database Queries

**New Filtering Functions in `src/lib/db/queries.ts`:**

```typescript
/**
 * Get active (non-archived) notes for the note list.
 * Replaces current getNotesForList() or adds a parameter.
 */
export async function getNotesForList(includeArchived = false): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const whereClause = includeArchived 
        ? ""
        : `AND (metadata->>'isArchived')::boolean IS NOT TRUE`;
    
    const result = await db.query<{
        doc_id: string;
        title: string;
        preview: string;
        metadata: DocumentMetadata;
    }>(`
        SELECT doc_id, title, LEFT(plain_text_content, 150) as preview, metadata
        FROM search_index
        WHERE 1=1 ${whereClause}
        ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST
    `);
    // ... process and return
}

/**
 * Get archived notes only.
 */
export async function getArchivedNotes(): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const result = await db.query<{
        doc_id: string;
        title: string;
        preview: string;
        metadata: DocumentMetadata;
    }>(`
        SELECT doc_id, title, LEFT(plain_text_content, 150) as preview, metadata
        FROM search_index
        WHERE (metadata->>'isArchived')::boolean IS TRUE
        ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST
    `);
    // ... process and return
}

/**
 * Get active notes for a specific folder (excluding archived).
 */
export async function getNotesForListByFolder(
    folderId: string,
    includeArchived = false
): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const whereClause = includeArchived
        ? ""
        : `AND (metadata->>'isArchived')::boolean IS NOT TRUE`;
    
    const result = await db.query<{
        doc_id: string;
        title: string;
        preview: string;
        metadata: DocumentMetadata;
    }>(`
        SELECT doc_id, title, LEFT(plain_text_content, 150) as preview, metadata
        FROM search_index
        WHERE metadata->>'folderId' = $1 ${whereClause}
        ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST
    `, [folderId]);
    // ... process and return
}
```

**Migration Requirement:**
No schema change needed—the field lives in JSONB. However, add a migration to create a GIN index for efficiency:

```typescript
// In src/lib/db/pglite.ts runMigrations():
try {
    await database.exec(`
        CREATE INDEX IF NOT EXISTS idx_search_metadata_archived
        ON search_index ((metadata->>'isArchived'));
    `);
    console.log('[DB Migration] Archived metadata index ensured');
} catch (error) {
    console.warn('[DB Migration] Could not create archived metadata index:', error);
}
```

### 2.3 React Hooks & Mutations

**Update `src/hooks/useNotes.ts`:**

```typescript
// Query key for archived notes
export const archivedNotesQueryKey = ['notes', 'archived'] as const;

/**
 * New mutation: archive/unarchive a note.
 */
const toggleArchiveMutation = useMutation<void, Error, { docId: string; isArchived: boolean }, NoteMutationContext>({
    mutationFn: async ({ docId, isArchived }) => {
        const notes = queryClient.getQueryData<NoteListEntry[]>(notesQueryKey);
        const currentNote = notes?.find((n) => n.docId === docId);

        if (!currentNote) return;

        const updatedMetadata = { ...currentNote.metadata, isArchived };

        await updateSearchIndexMetadata(docId, currentNote.title, updatedMetadata);
        await updateSyncStatus(docId, 'pending');
    },
    onMutate: async ({ docId, isArchived }) => {
        // Cancel outgoing queries
        await queryClient.cancelQueries({ queryKey: notesQueryKey });
        await queryClient.cancelQueries({ queryKey: archivedNotesQueryKey });

        const previousNotes = queryClient.getQueryData<NoteListEntry[]>(notesQueryKey);
        const previousArchived = queryClient.getQueryData<NoteListEntry[]>(archivedNotesQueryKey);

        // Optimistically update cache
        if (!isArchived) {
            // Moving from archived → active
            queryClient.setQueryData<NoteListEntry[]>(archivedNotesQueryKey, (old) =>
                old?.filter((n) => n.docId !== docId) || []
            );
            queryClient.setQueryData<NoteListEntry[]>(notesQueryKey, (old) =>
                [...(old || []), { ...previousArchived?.find(n => n.docId === docId)! }].sort(...)
            );
        } else {
            // Moving from active → archived
            queryClient.setQueryData<NoteListEntry[]>(notesQueryKey, (old) =>
                old?.filter((n) => n.docId !== docId) || []
            );
            queryClient.setQueryData<NoteListEntry[]>(archivedNotesQueryKey, (old) =>
                [...(old || []), { ...previousNotes?.find(n => n.docId === docId)! }].sort(...)
            );
        }

        return { previousNotes, previousArchived };
    },
    onError: (_err, _vars, context) => {
        if (context?.previousNotes) queryClient.setQueryData(notesQueryKey, context.previousNotes);
        if (context?.previousArchived) queryClient.setQueryData(archivedNotesQueryKey, context.previousArchived);
    },
    onSettled: () => {
        queryClient.invalidateQueries({ queryKey: notesQueryKey });
        queryClient.invalidateQueries({ queryKey: archivedNotesQueryKey });
    },
});

export function useNotes() {
    // ... existing code
    return {
        // ... existing mutations
        toggleArchive: toggleArchiveMutation,
    };
}

/**
 * New query hook for archived notes.
 */
export function useArchivedNotes() {
    return useQuery<NoteListEntry[]>({
        queryKey: archivedNotesQueryKey,
        queryFn: getArchivedNotes,
    });
}
```

### 2.4 UI Components

#### 2.4.1 Update NoteList to show "Archive" action

**File: `src/components/layout/NoteList.tsx`**

Add archive action to context menu:
```typescript
const ContextMenuWrapper
    items={[
        { 
            label: note.metadata.isPinned ? 'Unpin' : 'Pin',
            icon: note.metadata.isPinned ? PinOff : Pin,
            action: () => onTogglePin(note.docId, !note.metadata.isPinned),
        },
        {
            label: 'Share',
            icon: Share2,
            action: onShareNote,
        },
        {
            label: note.metadata.isArchived ? 'Unarchive' : 'Archive',
            icon: Archive,  // NEW: import Archive from lucide-react
            action: () => onToggleArchive(note.docId, !note.metadata.isArchived),
        },
        {
            label: 'Delete',
            icon: Trash2,
            action: () => onDeleteNote(note.docId),
            variant: 'destructive',
        }
    ]}
/>
```

**Swipe Action Enhancement:**
Currently, left-swipe shows delete. With archiving, consider:
- **Option A:** Left-swipe shows archive (non-destructive) instead of delete
  - Delete moves to context menu or requires confirmation
  - Better UX—users can recover archived notes
  
- **Option B:** Two-swipe pattern (left for archive, long-hold for delete)
  - More complexity, but preserves speed of delete
  
**Recommendation:** Go with **Option A**—swipe to archive, delete via context menu. This is safer and teaches users the archive pattern.

**Updated NoteItem:**
```typescript
// In onTouchEnd handler
const onTouchEnd = () => {
    // ... existing swipe logic
    if (isLeftSwipe && !isSwiped) {
        setIsSwiped(true);
        setSwipeOffset(maxSwipeDistance);
        triggerHaptic(15);
    }
};

// Background action changes from delete to archive
<div 
  className="absolute inset-y-0 right-0 w-20 bg-blue-500 flex items-center justify-center text-white"
  style={{ ... }}
>
  <button 
    onClick={(e) => {
      e.stopPropagation();
      triggerHaptic(20);
      onToggleArchive(note.docId, true);  // NEW
    }}
  >
    <Archive className="h-5 w-5" />
  </button>
</div>
```

#### 2.4.2 Update Sidebar to show "Archive" section

**File: `src/components/layout/Sidebar.tsx`**

Add a pseudo-folder for archived notes:
```typescript
interface SidebarProps {
    // ... existing props
    archivedNoteCount?: number;  // NEW
    onSelectArchive: () => void;  // NEW
}

export default function Sidebar({
    // ... existing props
    archivedNoteCount = 0,
    onSelectArchive,
}: SidebarProps) {
    // ... existing code
    
    return (
        <aside>
            {/* ... search, folders ... */}
            
            {/* Archive section (new pseudo-folder) */}
            <div className="px-2 py-2 mt-2">
                <button
                  onClick={onSelectArchive}
                  className={cn(
                    "w-full h-10 group relative transition-all duration-200 flex items-center",
                    selectedFolderId === '__archive__' ? "bg-accent" : "hover:bg-muted"
                  )}
                >
                  <Archive className="h-4 w-4 mr-2 shrink-0" />
                  <span className="text-sm flex-1 text-left">Archive</span>
                  {archivedNoteCount > 0 && (
                    <span className="text-xs text-muted-foreground mr-2">
                      {archivedNoteCount}
                    </span>
                  )}
                </button>
            </div>
            
            {/* ... logout, settings ... */}
        </aside>
    );
}
```

### 2.5 Sync Behavior

**How Archiving Syncs with Homebase:**

1. **User archives a note locally:**
   - `toggleArchiveMutation` calls `updateSearchIndexMetadata()`
   - Sets `isArchived: true` in metadata
   - Calls `updateSyncStatus(docId, 'pending')`

2. **Next sync cycle (SyncService.pushChanges):**
   - Finds pending sync records
   - Calls `pushNote()` for the archived note
   - Metadata change is sent to Homebase (NoteFileContent updated)
   - Remote note's `isArchived` field is set to `true`

3. **Remote pulls (SyncService.pullChanges):**
   - `handleRemoteNote()` processes remote changes
   - If remote `isArchived: true`, local metadata updated
   - Archived state syncs bidirectionally

**Code Path (existing, no changes needed):**
```typescript
// SyncService.ts
async handleRemoteNote(remoteFile: HomebaseFile<NoteFileContent>): Promise<void> {
    const content = remoteFile.fileMetadata.appData.content;
    
    const updatedMetadata = {
        title: content.title,
        folderId: remoteFile.fileMetadata.appData.groupId,
        tags: content.tags,
        excludeFromAI: content.excludeFromAI,
        isPinned: content.isPinned,
        isArchived: content.isArchived,  // NEW: will be picked up automatically
    };
    
    await upsertSearchIndex({ docId, metadata: updatedMetadata });
}
```

**Key Insight:** No changes to SyncService needed! The existing metadata sync infrastructure handles archiving automatically.

### 2.6 Bulk Operations (Future Enhancement)

**Potential bulk archive UI:**
```typescript
// Example: select multiple notes → archive all
const bulkArchiveMutation = useMutation<void, Error, string[]>({
    mutationFn: async (docIds: string[]) => {
        const notes = queryClient.getQueryData<NoteListEntry[]>(notesQueryKey);
        const updates = docIds.map(docId => {
            const note = notes?.find(n => n.docId === docId)!;
            return {
                docId,
                metadata: { ...note.metadata, isArchived: true }
            };
        });
        
        for (const { docId, metadata } of updates) {
            await updateSearchIndexMetadata(docId, metadata.title, metadata);
            await updateSyncStatus(docId, 'pending');
        }
    },
});
```

---

## 3. Search & Advanced Filtering

### 3.1 Update Advanced Search

**File: `src/lib/db/queries.ts`**

The `advancedSearch()` function should respect the archive filter:
```typescript
/**
 * Advanced search with optional archive filter.
 */
export async function advancedSearch(
    query: string,
    options?: { includeArchived?: boolean }
): Promise<AdvancedSearchResult[]> {
    const db = await getDatabase();
    // ... existing FTS logic ...
    
    const whereClause = options?.includeArchived
        ? ""
        : `AND (s.metadata->>'isArchived')::boolean IS NOT TRUE`;
    
    const result = await db.query<...>(`
        WITH search_params AS ( ... )
        SELECT ...
        FROM search_index s, search_params sp
        WHERE 
            (s.search_vector @@ sp.tsq OR ...)
            ${whereClause}
        ORDER BY ...
    `, [...]);
    // ...
}
```

**Hook Update:**
```typescript
// In components, pass includeArchived when searching
advancedSearch(query, { includeArchived: false })  // Default: exclude archived
```

---

## 4. Migration & Backward Compatibility

### 4.1 Database Migration

**File: `src/lib/db/pglite.ts`** (in `runMigrations()` function)

```typescript
// Add after existing migrations
try {
    await database.exec(`
        CREATE INDEX IF NOT EXISTS idx_search_metadata_archived
        ON search_index ((metadata->>'isArchived'));
    `);
    console.log('[DB Migration] Archive metadata index created');
} catch (error) {
    console.warn('[DB Migration] Could not create archive index:', error);
}
```

**Why no schema change needed:**
- `isArchived` is optional in metadata JSONB
- Existing notes will have `undefined` (treated as `false`)
- SQL `IS NOT TRUE` safely handles NULL/undefined values

### 4.2 Backward Compatibility

**Existing data:** All notes without `isArchived` field default to `false` (active).

**Sync with older clients:** If a user has the archive feature and syncs with Homebase, then uses an older client build:
- Older clients won't see the `isArchived` field
- Older clients will treat archived notes as active (safe fallback)
- Once they upgrade, archived state will be restored

---

## 5. Files Requiring Modification

### 5.1 Type Definitions
- **`src/types/index.ts`**
  - Add `isArchived?: boolean;` to `DocumentMetadata`
  - Add `isArchived?: boolean;` to `NoteFileContent`

### 5.2 Database Layer
- **`src/lib/db/queries.ts`**
  - Modify `getNotesForList()` to accept `includeArchived` parameter
  - Add new `getArchivedNotes()` function
  - Modify `getNotesForListByFolder()` to accept `includeArchived` parameter
  - Modify `advancedSearch()` to respect archive filter

- **`src/lib/db/pglite.ts`**
  - Add migration for `idx_search_metadata_archived` index

### 5.3 React Hooks
- **`src/hooks/useNotes.ts`**
  - Add `toggleArchiveMutation` (similar to `togglePinMutation`)
  - Add `useArchivedNotes()` query hook
  - Export `archivedNotesQueryKey`

### 5.4 React Components
- **`src/components/layout/NoteList.tsx`**
  - Add `onToggleArchive` prop to `NoteListProps`
  - Add archive to context menu
  - Change swipe action from delete to archive (or add second swipe)
  - Pass `onToggleArchive` to `NoteItem`

- **`src/components/layout/Sidebar.tsx`**
  - Add `archivedNoteCount` prop
  - Add `onSelectArchive` prop
  - Render Archive section with count badge
  - Handle "Archive" folder selection (special case `__archive__`)

- **`src/pages/Main.tsx` or main layout file** (where NoteList and Sidebar are used)
  - Wire up `onSelectArchive` handler
  - Pass archived notes to display when Archive is selected
  - Update `selectedFolderId` to support `__archive__` pseudo-folder
  - Fetch and pass `archivedNoteCount` to Sidebar

### 5.5 No Changes Needed
- **`src/lib/homebase/SyncService.ts`** — Metadata sync is generic
- **`src/lib/homebase/NotesDriveProvider.ts`** — Handles NoteFileContent generically
- **`src/lib/homebase/FolderDriveProvider.ts`** — Not affected
- **`src/hooks/useFolders.ts`** — Not affected

---

## 6. Implementation Phases

### Phase 1: Core Archiving (Required)
1. Add `isArchived` to type definitions
2. Implement database queries (`getArchivedNotes`, update others)
3. Add database migration (index)
4. Implement `toggleArchiveMutation` in `useNotes.ts`
5. Add archive button to context menu in NoteList
6. Test with manual sync

### Phase 2: UI Polish (Recommended)
1. Add Archive section to Sidebar
2. Update swipe action to archive (safer than delete)
3. Add archived count badge in Sidebar
4. Move delete to context menu (with confirmation dialog)
5. Implement archive filtering in search

### Phase 3: Advanced Features (Optional)
1. Bulk archive operations
2. Archive cleanup/expiry policies (auto-delete archived after N days?)
3. Archive as a real folder (more complex, lower priority)
4. Archive search/filtering UI
5. Restore from archive (undo pattern)

---

## 7. Testing Strategy

### Unit Tests
- `toggleArchiveMutation`: archive and unarchive a note
- `getArchivedNotes`: returns only archived notes
- `getNotesForList(false)`: excludes archived notes
- `advancedSearch(..., {includeArchived: false})`: filters correctly

### Integration Tests
- Archive locally, sync to Homebase, verify remote has `isArchived: true`
- Pull archived note from Homebase, verify local metadata updated
- Archive + unarchive + sync cycle
- Bulk operations

### E2E Tests
- User archives note via swipe, note disappears from main list
- User navigates to Archive section, sees archived note
- User unarchives, note reappears in main list
- Search excludes archived notes by default
- Sync propagates archive state bidirectionally

---

## 8. Edge Cases & Considerations

### 8.1 Pinned + Archived
**Question:** Can a note be both pinned and archived?

**Answer:** No. If a note is archived, it should not appear in the pinned section. 

**Implementation:**
```typescript
// In NoteList grouping logic, filter out archived before grouping
const pinnedNotes = notes.filter(n => n.metadata.isPinned && !n.metadata.isArchived);
```

### 8.2 Folder Deletion + Archiving
**Question:** If a folder is deleted, what happens to archived notes in it?

**Answer:** Archived notes follow the same deletion flow as active notes (via `handleDeletedFolder`).

**Code:** No changes needed—existing `handleDeletedFolder` doesn't filter by `isArchived`.

### 8.3 Collaborative Notes
**Question:** Can a user archive a collaborative note?

**Answer:** Yes. Archive state is per-user metadata, not shared.

**Implication:** User A can archive a shared note; User B still sees it active. This is intentional (per-user read status pattern).

### 8.4 Search Behavior
**Question:** Should search include archived notes?

**Answer:** By default, no (same as note list filtering). Provide an option (`includeArchived` flag) for advanced users.

### 8.5 Sync Conflicts
**Question:** What if User A archives and User B edits simultaneously?

**Answer:** Homebase last-writer-wins for metadata. If User B's push comes after A's archive, the note becomes unarchived + edited. Acceptable tradeoff (archived is metadata, not content).

---

## 9. Code Examples

### 9.1 Complete Hook Usage Example
```typescript
// In a component
function MyNotesList() {
    const { toggleArchive } = useNotes();
    const { data: activeNotes } = useNotes().get;
    const { data: archivedNotes } = useArchivedNotes();
    const [showArchive, setShowArchive] = useState(false);

    const handleArchive = (docId: string, isArchived: boolean) => {
        toggleArchive.mutate({ docId, isArchived });
    };

    return (
        <>
            <NoteList
              notes={showArchive ? archivedNotes : activeNotes}
              onToggleArchive={handleArchive}
              // ... other props
            />
            <Sidebar
              archivedNoteCount={archivedNotes?.length || 0}
              onSelectArchive={() => setShowArchive(true)}
              // ... other props
            />
        </>
    );
}
```

### 9.2 Database Query Example
```typescript
// In src/lib/db/queries.ts
export async function getNotesForListWithArchive(
    options?: { includeArchived?: boolean }
): Promise<NoteListEntry[]> {
    const db = await getDatabase();
    const includeArchived = options?.includeArchived ?? false;
    
    let whereClause = '';
    if (!includeArchived) {
        whereClause = `WHERE (metadata->>'isArchived')::boolean IS NOT TRUE`;
    }
    
    const result = await db.query<{
        doc_id: string;
        title: string;
        preview: string;
        metadata: DocumentMetadata;
    }>(`
        SELECT doc_id, title, LEFT(plain_text_content, 150) as preview, metadata
        FROM search_index
        ${whereClause}
        ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST
    `);
    
    return result.rows.map(row => ({
        docId: row.doc_id,
        title: row.title,
        preview: row.preview || '',
        metadata: row.metadata,
    }));
}
```

---

## 10. Success Criteria

- [x] Notes can be archived and unarchived
- [x] Archived notes don't appear in the main note list
- [x] Archived notes appear in a dedicated Archive section
- [x] Archive state syncs bidirectionally with Homebase
- [x] Search excludes archived notes by default
- [x] Swipe/context menu actions work for archiving
- [x] Archived count displayed in Sidebar
- [x] No data loss (archived notes can be restored)
- [x] Backward compatible with existing data
- [x] No impact on existing sync or folder features

---

## 11. Related Documents

- `src/types/index.ts` — Type definitions
- `src/lib/db/pglite.ts` — Schema initialization and migrations
- `src/lib/db/queries.ts` — Database queries
- `src/hooks/useNotes.ts` — Note CRUD hooks
- `src/components/layout/NoteList.tsx` — Note list UI
- `src/components/layout/Sidebar.tsx` — Sidebar navigation
- `src/lib/homebase/SyncService.ts` — Sync orchestration
- `src/lib/homebase/NotesDriveProvider.ts` — Remote note operations

---

## Appendix: Migration Checklist

- [ ] Type definitions updated (DocumentMetadata, NoteFileContent)
- [ ] Database index migration created
- [ ] Query functions implemented (getArchivedNotes, updated getNotesForList)
- [ ] toggleArchiveMutation implemented
- [ ] useArchivedNotes hook created
- [ ] NoteList updated with archive action
- [ ] Sidebar updated with Archive section
- [ ] Main layout wired up (selectedFolderId handling)
- [ ] Search updated to respect includeArchived filter
- [ ] Unit tests written
- [ ] Integration tests written
- [ ] Manual E2E testing completed
- [ ] Sync tested locally and with Homebase
- [ ] Documentation updated

