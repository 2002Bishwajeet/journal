# P3 Collaboration UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three UI features — sidebar "Shared with me" section, TabBar collaborative badge, and editor CollaborativePopover — to make collaboration status visible across the app.

**Architecture:** All features read from existing data (search_index metadata JSONB). One new DB query function, one new React hook, one new component (CollaborativePopover). Sidebar and TabBar receive data via props from JournalLayout. The `/shared` pseudo-route reuses the existing `/:folderId/:noteId?` pattern.

**Tech Stack:** React, TanStack Query, Radix Popover, Lucide icons, Tailwind CSS, PGlite

**Spec:** `docs/superpowers/specs/2026-04-21-collaboration-ui-p3-design.md`

---

## Task 1: DB Query — `getCollaborativeNotesForList()`

**Files:**
- Modify: `src/lib/db/queries.ts` (add function after `getNotesForListByFolder` ~line 200)
- Test: `src/__tests__/database.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/database.test.ts`:

```typescript
describe('getCollaborativeNotesForList', () => {
    it('should return only collaborative notes sorted by modified desc', async () => {
        // Insert a collaborative note
        await upsertSearchIndex({
            docId: 'collab-1',
            title: 'Shared Doc',
            plainTextContent: 'shared content',
            metadata: {
                title: 'Shared Doc',
                folderId: 'main',
                tags: [],
                timestamps: { created: '2026-04-21T10:00:00Z', modified: '2026-04-21T12:00:00Z' },
                excludeFromAI: false,
                isCollaborative: true,
                circleIds: ['circle-1'],
                recipients: ['alice.odin'],
                lastEditedBy: 'alice.odin',
            },
        });

        // Insert a non-collaborative note
        await upsertSearchIndex({
            docId: 'private-1',
            title: 'Private Doc',
            plainTextContent: 'private content',
            metadata: {
                title: 'Private Doc',
                folderId: 'main',
                tags: [],
                timestamps: { created: '2026-04-21T11:00:00Z', modified: '2026-04-21T13:00:00Z' },
                excludeFromAI: false,
            },
        });

        const results = await getCollaborativeNotesForList();
        expect(results).toHaveLength(1);
        expect(results[0].docId).toBe('collab-1');
        expect(results[0].title).toBe('Shared Doc');
        expect(results[0].preview).toBe('shared content');
        expect(results[0].metadata.isCollaborative).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/database.test.ts -t "getCollaborativeNotesForList"`
Expected: FAIL — `getCollaborativeNotesForList is not a function`

- [ ] **Step 3: Implement the query**

Add to `src/lib/db/queries.ts` after the `getNotesForListByFolder` function:

```typescript
export async function getCollaborativeNotesForList(): Promise<NoteListEntry[]> {
    const db = await getDatabase();
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
         WHERE (metadata->>'isCollaborative')::boolean = true
         ORDER BY
            (metadata->>'isPinned')::boolean DESC NULLS LAST,
            (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST`
    );
    return result.rows.map(row => ({
        docId: row.doc_id,
        title: row.title,
        preview: row.preview || '',
        metadata: row.metadata,
    }));
}
```

- [ ] **Step 4: Add import in the test file**

Add `getCollaborativeNotesForList` to the import from `@/lib/db/queries` in `src/__tests__/database.test.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/database.test.ts -t "getCollaborativeNotesForList"`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All 175+ tests pass

---

## Task 2: React Hook — `useCollaborativeNotes()`

**Files:**
- Modify: `src/hooks/useNotes.ts` (add hook after `useNotesByFolder`)

- [ ] **Step 1: Add the hook**

Add to `src/hooks/useNotes.ts` after the `useNotesByFolder` function:

```typescript
export function useCollaborativeNotes() {
    return useQuery<NoteListEntry[]>({
        queryKey: [...notesQueryKey, 'collaborative'],
        queryFn: getCollaborativeNotesForList,
    });
}
```

- [ ] **Step 2: Add import**

Add `getCollaborativeNotesForList` to the import from `@/lib/db/queries` at the top of `src/hooks/useNotes.ts`.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

---

## Task 3: Sidebar — "Shared with me" Section

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/layouts/JournalLayout.tsx`

- [ ] **Step 1: Add props to Sidebar**

In `src/components/layout/Sidebar.tsx`, add `Users` to the lucide-react import:

```typescript
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Hash,
  Plus,
  Search,
  Settings,
  LogOut,
  Trash2,
  Users,
} from "lucide-react";
```

Add two new props to `SidebarProps` (after `onSelectFolder`):

```typescript
  collaborativeCount?: number;
  onSelectShared?: () => void;
```

Add them to the function destructuring:

```typescript
export default function Sidebar({
  folders,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onDeleteFolder,
  onSearch,
  onSettings,
  onLogout,
  collaborativeCount,
  onSelectShared,
  tags,
  selectedTag,
  onSelectTag,
  className = "",
}: SidebarProps) {
```

- [ ] **Step 2: Add "Shared with me" entry in the sidebar**

Insert the following JSX inside the `<ScrollArea>`, right before the `<div className="px-2 py-2">` that contains the "Folders" header (line 143). Place it between `<PullToRefresh>` opening and the folders `<div>`:

```tsx
            {/* Shared with me — only shown when collaborative notes exist */}
            {collaborativeCount && collaborativeCount > 0 && (
              <div className="px-2 pt-2 pb-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={selectedFolderId === 'shared' ? "secondary" : "ghost"}
                      className={cn(
                        "w-full h-10 group relative transition-all duration-200 flex items-center",
                        isCollapsed ? "justify-center px-0" : "justify-start px-2",
                        selectedFolderId === 'shared' && "bg-accent text-accent-foreground font-medium hover:bg-accent"
                      )}
                      onClick={onSelectShared}
                    >
                      <Users
                        className={cn(
                          "h-4 w-4 shrink-0 text-blue-500",
                          !isCollapsed && "mr-2"
                        )}
                      />
                      {!isCollapsed && (
                        <>
                          <span className="text-sm truncate flex-1 text-left">Shared with me</span>
                          <span className="ml-auto text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded-full font-medium">
                            {collaborativeCount}
                          </span>
                        </>
                      )}
                    </Button>
                  </TooltipTrigger>
                  {isCollapsed && (
                    <TooltipContent side="right">
                      Shared with me ({collaborativeCount})
                    </TooltipContent>
                  )}
                </Tooltip>
              </div>
            )}
```

- [ ] **Step 3: Wire in JournalLayout**

In `src/layouts/JournalLayout.tsx`:

Add import for `useCollaborativeNotes`:
```typescript
import { useNotes, useNotesByFolder, notesQueryKey, useCollaborativeNotes } from "@/hooks/useNotes";
```

After the existing `useNotesByFolder` call (~line 179), add:
```typescript
  const { data: collaborativeNotes = [], isLoading: isCollaborativeLoading } = useCollaborativeNotes();
```

Update the `filteredNotes` / `notesToShow` logic. Find the line:
```typescript
  const { data: filteredNotes = [], isLoading: isFilteredNotesLoading } = useNotesByFolder(folderId);
```

And the line:
```typescript
  const notesToShow = selectedTag ? (tagFilteredNotes ?? []) : filteredNotes;
```

Replace the `notesToShow` line with:
```typescript
  const notesToShow = selectedTag
    ? (tagFilteredNotes ?? [])
    : folderId === 'shared'
      ? collaborativeNotes
      : filteredNotes;

  const isNotesToShowLoading = folderId === 'shared' ? isCollaborativeLoading : isFilteredNotesLoading;
```

Update the `isLoading` prop on `<NoteList>` from `isFilteredNotesLoading` to `isNotesToShowLoading`.

Add props to `<Sidebar>`:
```typescript
  collaborativeCount={collaborativeNotes.length}
  onSelectShared={() => navigate('/shared')}
```

- [ ] **Step 4: Verify TypeScript and lint**

Run: `npx tsc --noEmit && npx eslint src/layouts/JournalLayout.tsx src/components/layout/Sidebar.tsx`
Expected: No errors

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

---

## Task 4: TabBar — Collaborative Badge

**Files:**
- Modify: `src/components/layout/TabBar.tsx`
- Modify: `src/layouts/JournalLayout.tsx`

- [ ] **Step 1: Add Users icon import and prop to TabBar**

In `src/components/layout/TabBar.tsx`, update the import:

```typescript
import { X, FileText, Users } from "lucide-react";
```

Add `collaborativeTabIds` to `TabBarProps`:

```typescript
interface TabBarProps {
  tabs: TabInfo[];
  activeTabId: string | null;
  onTabClick: (docId: string) => void;
  onTabClose: (docId: string) => void;
  collaborativeTabIds?: Set<string>;
  className?: string;
}
```

Add it to the function destructuring:

```typescript
export default function TabBar({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  collaborativeTabIds,
  className,
}: TabBarProps) {
```

- [ ] **Step 2: Render the icon in each tab**

Find the `<FileText>` icon in the tab render (line 47). After the `</span>` that contains the title and dirty indicator (line 51), add the Users icon:

```tsx
          {collaborativeTabIds?.has(tab.docId) && (
            <Users className="h-3 w-3 text-blue-500 shrink-0 opacity-80" />
          )}
```

Place it between the title `<span>` and the close `<button>`.

- [ ] **Step 3: Derive and pass collaborativeTabIds in JournalLayout**

In `src/layouts/JournalLayout.tsx`, add `useMemo` to the React import (if not already there):

```typescript
import { useState, useEffect, useRef, lazy, Suspense, useMemo } from "react";
```

After the `notesRef` setup (~line 112), add:

```typescript
  const collaborativeTabIds = useMemo(
    () => new Set(notes.filter(n => n.metadata.isCollaborative).map(n => n.docId)),
    [notes]
  );
```

Find the `<TabBar>` component (~line 399) and add the prop:

```tsx
          <TabBar
            tabs={openTabs}
            activeTabId={activeTabId}
            onTabClick={handleTabClick}
            onTabClose={handleTabClose}
            collaborativeTabIds={collaborativeTabIds}
          />
```

- [ ] **Step 4: Verify TypeScript and lint**

Run: `npx tsc --noEmit && npx eslint src/components/layout/TabBar.tsx src/layouts/JournalLayout.tsx`
Expected: No errors

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

---

## Task 5: CollaborativePopover Component

**Files:**
- Create: `src/components/editor/CollaborativePopover.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/editor/CollaborativePopover.tsx`:

```tsx
import { Users, ChevronDown } from 'lucide-react';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { useCircles } from '@/hooks/circles/useCircles';
import { AuthorImage } from '@/components/author/AuthorImage';

interface CollaborativePopoverProps {
    circleIds?: string[];
    recipients?: string[];
    lastEditedBy?: string;
}

export function CollaborativePopover({
    circleIds,
    recipients,
    lastEditedBy,
}: CollaborativePopoverProps) {
    const { fetch: circlesFetch } = useCircles(true);
    const circles = circlesFetch.data || [];

    const matchedCircles = circles.filter(
        c => c.id && circleIds?.includes(c.id)
    );

    return (
        <Popover>
            <PopoverTrigger asChild>
                <button className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-500 text-xs hover:bg-blue-500/20 transition-colors cursor-pointer">
                    <Users className="h-3 w-3" />
                    <span>Collaborative</span>
                    <ChevronDown className="h-3 w-3" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                    Shared with
                </div>

                {matchedCircles.length > 0 ? (
                    <div className="space-y-3">
                        {matchedCircles.map(circle => (
                            <div key={circle.id}>
                                <div className="text-sm font-medium mb-1.5">
                                    {circle.name}
                                </div>
                                {recipients && recipients.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                        {recipients.map(odinId => (
                                            <div
                                                key={odinId}
                                                className="flex items-center gap-1 bg-muted px-1.5 py-0.5 rounded-full"
                                            >
                                                <AuthorImage
                                                    odinId={odinId}
                                                    className="h-4 w-4 rounded-full"
                                                />
                                                <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                                                    {odinId.split('.')[0]}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-sm text-muted-foreground">
                        {circleIds?.length
                            ? 'Unknown circle'
                            : 'Shared with your circles'}
                    </div>
                )}

                {lastEditedBy && (
                    <div className="border-t mt-3 pt-2 text-xs text-muted-foreground">
                        Last edited by{' '}
                        <span className="text-foreground">
                            {lastEditedBy.split('.')[0]}
                        </span>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

---

## Task 6: Wire CollaborativePopover into EditorPage

**Files:**
- Modify: `src/pages/EditorPage.tsx`

- [ ] **Step 1: Replace static badge with CollaborativePopover**

In `src/pages/EditorPage.tsx`, add import:

```typescript
import { CollaborativePopover } from '@/components/editor/CollaborativePopover';
```

Find the mobile header section with the existing static badge (lines 74-92). Replace the entire `{selectedNoteMetadata?.isCollaborative && ( ... )}` block with:

```tsx
        {selectedNoteMetadata?.isCollaborative && (
          <CollaborativePopover
            circleIds={selectedNoteMetadata.circleIds}
            recipients={selectedNoteMetadata.recipients}
            lastEditedBy={selectedNoteMetadata.lastEditedBy}
          />
        )}
```

Remove `Users` from the lucide-react import since it's no longer used directly. Also remove `Tooltip`, `TooltipContent`, `TooltipProvider`, `TooltipTrigger` from the import if no longer used elsewhere in the file (check first — they may be used elsewhere).

- [ ] **Step 2: Add popover to desktop toolbar area**

Find the desktop toolbar section (~lines 96-106). After the `{editor && <AIMenu editor={editor} />}` line, add the collaborative badge for desktop:

```tsx
        {selectedNoteMetadata?.isCollaborative && (
          <div className="ml-auto px-3">
            <CollaborativePopover
              circleIds={selectedNoteMetadata.circleIds}
              recipients={selectedNoteMetadata.recipients}
              lastEditedBy={selectedNoteMetadata.lastEditedBy}
            />
          </div>
        )}
```

- [ ] **Step 3: Clean up unused imports**

Check if `Tooltip`, `TooltipContent`, `TooltipProvider`, `TooltipTrigger` are still used in EditorPage.tsx. If not, remove them from the import. Also remove `Users` from the lucide-react import if no longer directly used.

- [ ] **Step 4: Verify TypeScript and lint**

Run: `npx tsc --noEmit && npx eslint src/pages/EditorPage.tsx src/components/editor/CollaborativePopover.tsx`
Expected: No errors

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

---

## Task 7: Final Verification

- [ ] **Step 1: Run full lint + type check + tests**

Run: `npx tsc --noEmit && npx eslint src/ && npx vitest run`
Expected: 0 errors, 0 warnings, all tests pass

- [ ] **Step 2: Verify the collaborative query invalidation**

Check that `notesQueryKey` invalidation (already wired in P1 fixes) also invalidates the `[...notesQueryKey, 'collaborative']` query. TanStack Query's `invalidateQueries({ queryKey: notesQueryKey })` uses prefix matching, so `['notes']` invalidates `['notes', 'collaborative']` automatically. No additional wiring needed.

- [ ] **Step 3: Start dev server and test manually**

Run: `npm run dev`

Test these scenarios:
1. Open sidebar — "Shared with me" should NOT appear (no collaborative notes yet)
2. Mark a note collaborative via context menu — after success, sidebar should show "Shared with me (1)"
3. Click "Shared with me" — NoteList shows only collaborative notes
4. Open a collaborative note — editor shows "Collaborative" badge with dropdown chevron
5. Click the badge — popover shows circle name(s) and member chips
6. Check TabBar — collaborative note tab should have small blue Users icon
7. Revoke collaboration — sidebar section disappears, badge gone, tab icon gone
