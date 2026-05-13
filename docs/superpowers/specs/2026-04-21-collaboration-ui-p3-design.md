# P3 Collaboration UI — Design Spec

> Date: 2026-04-21
> Scope: Three UI additions for collaboration visibility
> Branch: feat-collaboration

---

## Features

### 1. Sidebar "Shared with me" Section

A dedicated section above the folder list showing all collaborative notes.

**Placement:** Above folders, below "New Note" button.
**Visual:** Blue Users icon + "Shared with me" label + count badge (e.g. "3").
**Behavior:** Clicking navigates to `/shared`. NoteList shows all notes where `isCollaborative === true`, sorted by last modified. Sidebar highlights this entry and unhighlights all folders.

**Routing:** Uses the existing `/:folderId/:noteId?` route pattern. `'shared'` is a reserved folderId string — JournalLayout detects it and swaps the query from `useNotesByFolder(folderId)` to `useCollaborativeNotes()`. No new route definition needed.

**Navigation within shared view:** Clicking a note navigates to `/shared/:noteId`. Editor opens. Back button returns to `/shared`.

### 2. TabBar Collaborative Badge

A small blue Users icon next to the tab title for collaborative notes.

**Data source:** JournalLayout derives a `Set<string>` of collaborative docIds from the existing notes query data. Passed as `collaborativeTabIds` prop to TabBar. Pure presentational — no hooks inside TabBar.

**Visual:** Same 12px blue Users icon used in NoteList, positioned after the tab title text, before the close button. Opacity 0.8 to avoid visual noise.

### 3. Editor CollaborativePopover

A clickable badge in the editor header that expands into a popover showing who has access.

**Trigger:** "Collaborative" badge with a dropdown chevron. Rendered on both desktop and mobile when `selectedNoteMetadata?.isCollaborative` is true. Replaces the existing static mobile-only badge.

**Popover contents:**
- Section header: "Shared with"
- For each circle (matched from `metadata.circleIds` via `useCircles()`): circle name + member avatar chips
- Member chips: `AuthorImage` (16px rounded) + shortened OdinId
- Footer: "Last edited by {lastEditedBy}" with timestamp

**Component:** New file `src/components/editor/CollaborativePopover.tsx`. Uses existing Radix Popover from `@/components/ui/popover`.

---

## Data Layer

No schema changes. All reads from existing data:

| Feature | Data source | Hook |
|---------|------------|------|
| Sidebar count + list | `search_index` where `metadata.isCollaborative = true` | New `useCollaborativeNotes()` in `useNotes.ts` |
| TabBar badge | Derived from existing `notes` query data | `useMemo` in JournalLayout |
| Editor popover | `selectedNoteMetadata.circleIds` + `recipients` | Existing `useCircles()` + `AuthorImage` |

### New query: `useCollaborativeNotes()`

```typescript
export function useCollaborativeNotes() {
    return useQuery<NoteListEntry[]>({
        queryKey: [...notesQueryKey, 'collaborative'],
        queryFn: getCollaborativeNotes, // new DB query function
    });
}
```

### New DB function: `getCollaborativeNotes()`

Query `search_index` filtering on `metadata->>'isCollaborative' = 'true'`, returning `NoteListEntry[]` sorted by modified desc. Same shape as `getNotesForList()` with the filter added.

---

## Component Changes

### `src/components/layout/Sidebar.tsx`
- Add "Shared with me" entry above folders section
- Accept `collaborativeCount: number` prop (or call `useCollaborativeNotes` directly)
- Highlight when `folderId === 'shared'`
- `onClick`: `navigate('/shared')`

### `src/components/layout/TabBar.tsx`
- Accept new prop `collaborativeTabIds?: Set<string>`
- For each tab, if `collaborativeTabIds.has(tab.docId)`, render 12px blue Users icon after title

### `src/pages/EditorPage.tsx`
- Replace static mobile-only "Collaborative" badge with `<CollaborativePopover>` on both desktop and mobile
- Pass `circleIds`, `recipients`, `lastEditedBy` from `selectedNoteMetadata`

### `src/components/editor/CollaborativePopover.tsx` (new)
- Popover trigger: badge with Users icon + "Collaborative" + chevron
- Popover content: circle names (from `useCircles`), member avatars (from `AuthorImage`), lastEditedBy footer
- Styling: matches existing app design tokens (bg-muted, border, rounded-lg)

### `src/layouts/JournalLayout.tsx`
- Detect `folderId === 'shared'` → use `useCollaborativeNotes()` instead of `useNotesByFolder()`
- Derive `collaborativeTabIds` Set via `useMemo` from notes data
- Pass `collaborativeTabIds` to TabBar

### `src/hooks/useNotes.ts`
- Add `useCollaborativeNotes()` hook
- Add `getCollaborativeNotes()` query function

### `src/lib/db/queries.ts`
- Add `getCollaborativeNotesForList()` — same as `getNotesForList()` with `isCollaborative` filter

---

## Edge Cases

- **Zero collaborative notes:** "Shared with me" section is hidden entirely. No empty state to manage — the section only renders when `collaborativeCount > 0`.
- **Note becomes non-collaborative:** After revoking, note disappears from shared view on next query invalidation (already handled by P1 fixes).
- **Tab for deleted collaborative note:** TabBar reads from the Set — if note is deleted, its docId won't be in the derived Set. No stale state.
- **CircleIds not matching any circles:** Popover shows "Unknown circle" fallback text. Members still shown from `recipients`.
- **No recipients stored:** Popover shows circle name only, no member chips.

---

## Not In Scope

- Push notifications for collaborative edits (separate effort)
- Real-time presence indicators
- Collaborative folder support (V2 placeholder)
- Search/filter within the shared view
