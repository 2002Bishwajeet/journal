# Near-Native Note Loading Performance Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Achieve VSCode-level list performance — instant note list rendering, virtualized scrolling, and zero unnecessary data loading.

**Architecture:** Three-layer approach inspired by VSCode's file explorer: (1) lightweight list query that only fetches what the sidebar needs (title + preview snippet, NOT full content), (2) virtualized rendering via @tanstack/react-virtual so only visible rows hit the DOM, (3) React.memo on list items to prevent cascade re-renders. Plus missing database indexes.

**Tech Stack:** @tanstack/react-virtual (already installed), PGlite, React 19, TanStack Query

---

## Current Problems

1. `getAllDocuments()` fetches `plain_text_content` for EVERY note — the list only needs title + ~100 chars of preview. A user with 500 notes loads all 500 full texts into memory.
2. `NoteList` renders every note to the DOM via `ScrollArea` — no virtualization. 500 notes = 500 DOM nodes.
3. `NoteItem` has no `React.memo` — every parent state change re-renders every visible item.
4. Missing JSONB index on `metadata->>'folderId'` — folder filtering does a full table scan.
5. `@tanstack/react-virtual` is in package.json but imported nowhere.

## What VSCode Does

- **File tree**: virtualized list with fixed row heights, only renders visible + overscan rows
- **Content loading**: file content loaded lazily on tab open, NOT when tree renders
- **List data**: tree nodes carry only name + metadata, never file content
- **Memoization**: tree items are memoized, only re-render on own data change

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/db/queries.ts` | Modify | Add lightweight list query + pagination + missing indexes |
| `src/lib/db/pglite.ts` | Modify | Add JSONB index in migration |
| `src/hooks/useNotes.ts` | Modify | Switch to lightweight query for list, keep full query for editor |
| `src/components/layout/NoteList.tsx` | Modify | Wire @tanstack/react-virtual, memo NoteItem |
| `src/__tests__/queries.test.ts` | Modify | Test new query functions |

---

### Task 1: Lightweight List Query

**Why:** Currently `getAllDocuments()` returns `plain_text_content` for every note. The sidebar only displays `title`, a truncated preview, and `metadata.timestamps.modified`. Fetching full content for 500 notes wastes memory and slows the query.

**Files:**
- Modify: `src/lib/db/queries.ts:88-105`
- Modify: `src/types/index.ts`
- Test: `src/__tests__/queries.test.ts`

- [ ] **Step 1: Add the lightweight list entry type**

In `src/types/index.ts`, add after the `SearchIndexEntry` interface:

```typescript
/** Lightweight version for list rendering — no full content */
export interface NoteListEntry {
    docId: string;
    title: string;
    preview: string; // first ~120 chars of content
    metadata: DocumentMetadata;
}
```

- [ ] **Step 2: Write the failing test**

In `src/__tests__/queries.test.ts`, add a test for the new query:

```typescript
import { getNotesForList } from '@/lib/db';

describe('getNotesForList', () => {
    beforeEach(async () => {
        await resetTestDatabase();
    });

    it('returns notes with truncated preview instead of full content', async () => {
        // Insert a note with long content
        const docId = '00000000-0000-0000-0000-000000000099';
        const longContent = 'A'.repeat(500);
        await testDb!.query(
            `INSERT INTO search_index (doc_id, title, plain_text_content, metadata)
             VALUES ($1, $2, $3, $4)`,
            [docId, 'Test Note', longContent, JSON.stringify({
                title: 'Test Note',
                folderId: MAIN_FOLDER_ID,
                tags: [],
                timestamps: { created: new Date().toISOString(), modified: new Date().toISOString() },
                excludeFromAI: false,
            })]
        );

        const notes = await getNotesForList(testDb!);
        expect(notes).toHaveLength(1);
        expect(notes[0].preview.length).toBeLessThanOrEqual(150);
        expect(notes[0]).not.toHaveProperty('plainTextContent');
    });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/queries.test.ts -t "returns notes with truncated preview"`
Expected: FAIL — `getNotesForList` doesn't exist yet

- [ ] **Step 4: Implement `getNotesForList`**

In `src/lib/db/queries.ts`, add:

```typescript
import type { NoteListEntry } from '@/types';

/**
 * Lightweight query for the note list sidebar.
 * Returns only title, a short preview, and metadata — NOT full content.
 * This is the VSCode pattern: the tree never loads file content.
 */
export async function getNotesForList(database?: PGlite): Promise<NoteListEntry[]> {
    const db = database ?? await getDatabase();
    const result = await db.query<{
        doc_id: string;
        title: string;
        preview: string;
        metadata: DocumentMetadata;
    }>(
        `SELECT doc_id, title,
                LEFT(plain_text_content, 150) as preview,
                metadata
         FROM search_index
         ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST`
    );
    return result.rows.map(row => ({
        docId: row.doc_id,
        title: row.title,
        preview: row.preview || '',
        metadata: row.metadata,
    }));
}
```

Add the export to `src/lib/db/index.ts` if it exists, or ensure it's exported from `queries.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/queries.test.ts -t "returns notes with truncated preview"`
Expected: PASS

- [ ] **Step 6: Wire useNotes to the lightweight query**

In `src/hooks/useNotes.ts`, change the list query:

```typescript
import { getNotesForList, getAllDocuments, /* ... */ } from '@/lib/db';
import type { NoteListEntry, SearchIndexEntry } from '@/types';

export const notesQueryKey = ['notes'] as const;

// The main list query — lightweight, no full content
const query = useQuery<NoteListEntry[]>({
    queryKey: notesQueryKey,
    queryFn: getNotesForList,
});
```

Update the `NoteListProps` interface in `NoteList.tsx` to accept `NoteListEntry[]` instead of `SearchIndexEntry[]`. The only difference is `preview` instead of `plainTextContent`. Update the preview line:

```typescript
// In NoteItem, change:
<p className="text-xs text-muted-foreground truncate mt-0.5 w-full">
  {note.preview || 'No content'}
</p>
```

- [ ] **Step 7: Update optimistic mutations**

The mutations in `useNotes.ts` that do `queryClient.setQueryData<SearchIndexEntry[]>` need to use `NoteListEntry[]` instead. The shapes are nearly identical — just swap `plainTextContent` for `preview` in the optimistic inserts:

```typescript
// In createNoteMutation onMutate (if it has one) or mutationFn:
const newNote: NoteListEntry = {
    docId,
    title: metadata.title,
    preview: '',
    metadata,
};
```

- [ ] **Step 8: Run full tests + type check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: All pass, no type errors

- [ ] **Step 9: Commit**

```bash
git add src/lib/db/queries.ts src/hooks/useNotes.ts src/types/index.ts src/components/layout/NoteList.tsx src/__tests__/queries.test.ts
git commit -m "perf: lightweight list query — don't load full content for sidebar"
```

---

### Task 2: Virtualized Note List

**Why:** Currently all notes are rendered to the DOM. With 500+ notes, the browser must create, lay out, and paint 500+ DOM nodes. @tanstack/react-virtual keeps only visible rows (+ overscan) in the DOM.

**Files:**
- Modify: `src/components/layout/NoteList.tsx:104-191`

- [ ] **Step 1: Import useVirtualizer**

At the top of `NoteList.tsx`:

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react'; // add useRef to existing import
```

- [ ] **Step 2: Flatten groups into a virtualizable array**

The current `groupedNotes` is an array of `{ label, notes[] }`. For virtualization we need a flat list where each row is either a group header or a note item. Add after the `groupedNotes` useMemo:

```typescript
// Flatten groups into virtualizable rows
const flatRows = useMemo(() => {
    const rows: Array<
        | { type: 'header'; label: string; count: number; collapsed: boolean }
        | { type: 'note'; note: NoteListEntry }
    > = [];

    for (const group of groupedNotes) {
        const collapsed = collapsedGroups.has(group.label);
        rows.push({ type: 'header', label: group.label, count: group.notes.length, collapsed });
        if (!collapsed) {
            for (const note of group.notes) {
                rows.push({ type: 'note', note });
            }
        }
    }
    return rows;
}, [groupedNotes, collapsedGroups]);
```

- [ ] **Step 3: Set up the virtualizer**

Replace the current `<ScrollArea>` contents with a virtualized list. Add after `flatRows`:

```typescript
const scrollRef = useRef<HTMLDivElement>(null);

const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => flatRows[index].type === 'header' ? 32 : 64,
    overscan: 10,
});
```

- [ ] **Step 4: Replace ScrollArea with virtualized rendering**

Replace the `<ScrollArea>` block (lines ~121-175) with:

```tsx
<div ref={scrollRef} className="flex-1 min-h-0 w-full overflow-y-auto">
    <PullToRefresh onRefresh={handleRefresh} className="w-full">
    {isLoading ? (
        <div className="flex items-center justify-center h-32">
            <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
    ) : notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 px-4 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-2">No notes yet</p>
            <Button variant="link" size="sm" onClick={onCreateNote}>
                Create your first note
            </Button>
        </div>
    ) : (
        <div
            className="py-2 w-full relative"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
            {virtualizer.getVirtualItems().map((virtualRow) => {
                const row = flatRows[virtualRow.index];
                return (
                    <div
                        key={virtualRow.key}
                        className="absolute top-0 left-0 w-full"
                        style={{
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                        }}
                    >
                        {row.type === 'header' ? (
                            <button
                                onClick={() => toggleGroup(row.label)}
                                className="flex items-center w-full px-3 py-1 hover:bg-muted/50 transition-colors group/header"
                            >
                                {row.collapsed ?
                                    <ChevronRight className="h-3.5 w-3.5 mr-2 text-muted-foreground" /> :
                                    <ChevronDown className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                                }
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                                    {row.label}
                                </span>
                                <span className="ml-2 text-xs text-muted-foreground/50 opacity-0 group-hover/header:opacity-100 transition-opacity">
                                    {row.count}
                                </span>
                            </button>
                        ) : (
                            <NoteItem
                                note={row.note}
                                selectedNoteId={selectedNoteId}
                                onSelectNote={onSelectNote}
                                onDeleteNote={(id) => setNoteToDelete(id)}
                                onShareNote={() => onShareNote(row.note)}
                                onTogglePin={(id, isPinned) => togglePin.mutate({ docId: id, isPinned })}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    )}
    </PullToRefresh>
</div>
```

Remove the `<ScrollArea>` import if no longer used elsewhere.

- [ ] **Step 5: Type check and manual test**

Run: `npx tsc --noEmit`
Expected: No errors

Open the app, verify:
- Scrolling is smooth
- Group headers expand/collapse
- Context menu works on items
- Swipe-to-delete works on mobile
- Selected state highlights correctly

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/NoteList.tsx
git commit -m "perf: virtualize note list with @tanstack/react-virtual"
```

---

### Task 3: Memoize NoteItem

**Why:** Without `React.memo`, every parent re-render (scroll, state change, query refetch) re-renders every visible NoteItem. With memo, items only re-render when their own props change.

**Files:**
- Modify: `src/components/layout/NoteList.tsx:194-398`

- [ ] **Step 1: Wrap NoteItem with React.memo**

Change the NoteItem function declaration at line 194:

```typescript
import { useState, useMemo, memo } from 'react'; // add memo to import

// ... existing code ...

// Wrap with memo — only re-renders when props change
const NoteItem = memo(function NoteItem({
  note,
  selectedNoteId,
  onSelectNote,
  onDeleteNote,
  onShareNote,
  onTogglePin,
}: {
  note: NoteListEntry;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onShareNote: () => void;
  onTogglePin: (id: string, isPinned: boolean) => void;
}) {
  // ... existing NoteItem body unchanged ...
});
```

Note: `React.memo` does shallow comparison by default. The props here are either primitives (`selectedNoteId`, `string`) or stable references (`note` object from the query, callback functions). Since callbacks come from the parent and may be recreated, stabilize them:

- [ ] **Step 2: Stabilize callback props in parent**

In the `NoteList` component, the `onDeleteNote` and `onShareNote` callbacks are inline arrow functions. Wrap them:

```typescript
// These are already stable (from props): onSelectNote, onCreateNote
// These need stabilization:
const handleDeleteNote = useCallback((id: string) => setNoteToDelete(id), []);
const handleShareNote = useCallback((note: NoteListEntry) => onShareNote(note), [onShareNote]);
```

Update the virtualizer rendering to use these:

```tsx
<NoteItem
    note={row.note}
    selectedNoteId={selectedNoteId}
    onSelectNote={onSelectNote}
    onDeleteNote={handleDeleteNote}
    onShareNote={() => handleShareNote(row.note)}
    onTogglePin={(id, isPinned) => togglePin.mutate({ docId: id, isPinned })}
/>
```

Note: `onShareNote` still creates a closure per item (`() => handleShareNote(row.note)`). This is fine — memo will still skip re-renders when `selectedNoteId` hasn't changed for that item, which is the hot path. A custom comparator could optimize further but isn't worth the complexity.

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/NoteList.tsx
git commit -m "perf: memoize NoteItem to prevent unnecessary re-renders"
```

---

### Task 4: Add Missing Database Indexes

**Why:** `getDocumentsByFolder()` filters on `metadata->>'folderId'` without an index — this is a full table scan on every folder switch. Adding a GIN index on the JSONB metadata makes folder filtering use the index.

**Files:**
- Modify: `src/lib/db/pglite.ts:161-240` (inside `runMigrations`)
- Modify: `src/__tests__/testDb.ts`
- Test: `src/__tests__/queries.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/__tests__/queries.test.ts`, add:

```typescript
describe('getDocumentsByFolder', () => {
    it('returns only notes in the specified folder', async () => {
        const folder1 = MAIN_FOLDER_ID;
        const folder2 = '00000000-0000-0000-0000-000000000002';
        const now = new Date().toISOString();

        // Insert notes in different folders
        await testDb!.query(
            `INSERT INTO search_index (doc_id, title, plain_text_content, metadata) VALUES
             ($1, 'Note A', 'content a', $3),
             ($2, 'Note B', 'content b', $4)`,
            [
                '00000000-0000-0000-0000-000000000010',
                '00000000-0000-0000-0000-000000000011',
                JSON.stringify({ title: 'Note A', folderId: folder1, tags: [], timestamps: { created: now, modified: now }, excludeFromAI: false }),
                JSON.stringify({ title: 'Note B', folderId: folder2, tags: [], timestamps: { created: now, modified: now }, excludeFromAI: false }),
            ]
        );

        const folder1Notes = await getDocumentsByFolder(folder1);
        expect(folder1Notes).toHaveLength(1);
        expect(folder1Notes[0].title).toBe('Note A');
    });
});
```

- [ ] **Step 2: Add JSONB GIN index to migrations**

In `src/lib/db/pglite.ts`, inside `runMigrations()`, add after the content trigram index block:

```typescript
// Create GIN index on metadata JSONB for folder filtering
try {
    await database.exec(`
        CREATE INDEX IF NOT EXISTS idx_search_metadata_gin
        ON search_index USING GIN(metadata);
    `);
    console.log('[DB Migration] Metadata GIN index ensured');
} catch (error) {
    console.warn('[DB Migration] Could not create metadata GIN index:', error);
}
```

- [ ] **Step 3: Add same index to test database**

In `src/__tests__/testDb.ts`, add after the `idx_search_index_title` index:

```sql
CREATE INDEX IF NOT EXISTS idx_search_metadata_gin
ON search_index USING GIN(metadata);
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/queries.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/pglite.ts src/__tests__/testDb.ts src/__tests__/queries.test.ts
git commit -m "perf: add GIN index on metadata JSONB for faster folder filtering"
```

---

### Task 5: React Compiler (Optional — Eliminates Manual useCallback/useMemo)

**Why:** React 19 ships with an optional compiler that automatically memoizes components, hooks, and expressions. This eliminates the need for manual `useCallback`/`useMemo` calls across the entire codebase. Without the compiler (current state), these hooks are still necessary.

**Files:**
- Modify: `package.json` (add devDep)
- Modify: `vite.config.ts` (add babel plugin)

- [ ] **Step 1: Install the React Compiler**

```bash
npm install -D babel-plugin-react-compiler
```

- [ ] **Step 2: Configure in Vite**

In `vite.config.ts`, change the react plugin config:

```typescript
import react from '@vitejs/plugin-react'

// Change:
react()

// To:
react({
    babel: {
        plugins: [
            ['babel-plugin-react-compiler', {}],
        ],
    },
})
```

Note: This switches @vitejs/plugin-react from SWC mode to Babel mode for the compiler transform. Build times may increase slightly (~10-20%) but runtime performance improves because the compiler auto-memoizes everything.

- [ ] **Step 3: Verify build works**

Run: `npx tsc --noEmit && npm run build`
Expected: Clean build with no errors

- [ ] **Step 4: Gradual cleanup (do NOT do this immediately)**

After the compiler is stable for a week, you can optionally remove manual `useCallback`/`useMemo` calls that the compiler now handles automatically. The compiler is additive — existing manual memos are harmless, they just become redundant. Don't rush this step.

- [ ] **Step 5: Commit**

```bash
git add package.json vite.config.ts package-lock.json
git commit -m "perf: enable React Compiler for automatic memoization"
```

---

## Expected Impact

| Change | Before | After | Impact |
|--------|--------|-------|--------|
| Lightweight list query | ~500 KB for 500 notes (full content) | ~25 KB (title + 150-char preview) | **20x less memory** |
| Virtualized list | 500 DOM nodes | ~20 DOM nodes (visible + overscan) | **25x fewer DOM nodes** |
| React.memo NoteItem | Every item re-renders on any state change | Only changed items re-render | **Eliminates cascade re-renders** |
| JSONB index | Full table scan on folder filter | Index lookup | **O(n) → O(log n) folder queries** |
| React Compiler | Manual memoization | Automatic | **No perf regressions from missing memo** |

## What This Does NOT Cover (Future Work)

- **Cursor-based pagination** — useful if someone has 5000+ notes, but virtualization handles the rendering side. Add pagination if DB query time becomes the bottleneck.
- **Web Worker for PGlite** — moves all DB queries off the main thread. Big win but significant refactor. Consider if the lightweight query + virtualization aren't enough.
- **Local encryption** — separate concern, see encryption analysis in conversation.
