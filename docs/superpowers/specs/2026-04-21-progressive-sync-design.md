# Progressive Sync via PGlite Live Queries

**Date:** 2026-04-21
**Status:** Draft
**Author:** Bishwajeet Parhi + Claude

## Problem

The current sync system updates the UI only after the entire pull phase completes or via full React Query refetches on each websocket notification. When syncing 50+ notes (first-time sync or returning from offline), the note list stays stale until everything finishes. Users expect a WhatsApp-style experience where items appear progressively as they arrive.

## Solution

Replace React Query reads for notes/folders with PGlite's `live.incrementalQuery()`. Since `SyncService` already writes to PGlite item-by-item during pull, each write automatically triggers the live query to re-emit updated results. The UI updates progressively with zero additional plumbing.

## Design Decisions

### Approach: PGlite Live Queries (over 3 alternatives)

**Rejected alternatives:**
- **React Query Cache Patching** — direct `setQueryData` per item. Fragile (cache shape must match), cache/DB drift risk, multiple query keys to patch.
- **SyncStream Micro-batch Invalidation** — throttled `invalidateQueries()` every ~500ms. Workable but still manages the sync→UI pipeline manually. Full refetch on each invalidation cycle.
- **Event Bus (mitt/EventEmitter)** — full decoupling via typed events. Adds a second pub-sub system alongside React Query; event subscribers still need to update React Query. More indirection, no non-UI subscribers planned.

**Why PGlite Live wins:** The DB is already the source of truth. Making it the reactive layer eliminates an entire category of bugs (missed invalidations, cache/DB drift) and removes ~100 lines of optimistic update / invalidation / rollback boilerplate. All three data paths (batch sync, websocket, local actions) converge at PGlite — one reactive source, zero orchestration.

### React Query: Partial Replacement, Not Removal

React Query stays in the project for circles, contacts, connections, auth, images, link metadata, security context, and site data. Only note/folder list reads move to PGlite live queries.

**What React Query provided for notes/folders and why each is no longer needed:**

| Feature | Why unnecessary with live queries |
|---|---|
| Caching | PGlite is local — it IS the cache |
| Stale-while-revalidate | Live queries are always fresh |
| Background refetch on focus | Live queries are always fresh |
| Query deduplication | Live query subscription handles this |
| Optimistic updates | PGlite latency is ~5-15ms (worker roundtrip) — imperceptible. Optimistic updates solve network latency (100-2000ms), which doesn't exist here |
| Error rollback | Local PGlite writes almost never fail |

### Local-First Mutations

Mutations restructured to write locally first, sync remotely in background:

**Delete note (current):** optimistic remove → `deleteNoteRemote()` (network) → delete local → rollback on error → invalidate
**Delete note (new):** delete local (instant, live query auto-updates) → `deleteNoteRemote()` fire-and-forget → log to `sync_errors` on failure

Same pattern for: create note, update metadata, toggle pin, create/delete folder.

### Sync Progress UI

- Existing `onProgress` callback stays but is decoupled from data updates — it only drives the progress indicator, not the note list.
- Threshold: show full progress bar ("Syncing 12/50 notes...") when `total >= 10` items. Below that, notes silently stream into the list.
- `syncStatus` and `SyncProgress` types unchanged.

### WebSocket Path Unification

`useJournalWebsocket` removes all `invalidateQueries()` calls. The handler still calls `handleRemoteNote()` / `handleRemoteFolder()` (which write to PGlite), and the live query picks up changes automatically. `WebSocketProcessQueue` deduplication stays — still valuable for preventing duplicate DB writes from rapid-fire notifications.

## Architecture

### Data Flow (all three paths converge at PGlite)

```
Batch Sync Pull:
  SyncService.pullChanges() → upsertSearchIndex() → PGlite+live → UI auto-updates

Real-time WebSocket:
  WS notification → handleRemoteNote() → upsertSearchIndex() → PGlite+live → UI auto-updates

Local User Action:
  User creates/deletes/edits → write to PGlite → PGlite+live → UI auto-updates
```

### Components

#### 1. PGlite Worker — Live Extension

Add `live` extension to `src/lib/db/pglite-worker.ts`:

```ts
import { live } from '@electric-sql/pglite/live';
// Add to extensions: { pg_trgm, live }
```

No extra dependency — `live` ships with `@electric-sql/pglite` (already at ^0.4.4).

#### 2. `useLiveQuery<T>(sql, params?)` — Generic Hook

Location: `src/hooks/useLiveQuery.ts` (~40 lines)

- Gets PGlite instance
- Calls `db.live.incrementalQuery(sql, params)` — uses row diffing, only transmits changed/added/removed rows
- Subscribes to result changes → wraps `setState` in `startTransition()` so rapid sync updates don't block user interactions (per `rerender-transitions` rule)
- Uses primitive dependencies (SQL string, serialized params) to avoid re-establishing subscriptions on re-render (per `rerender-dependencies` rule)
- Cleans up subscription on unmount
- Returns `{ data: T[], isLoading: boolean, error: Error | null }`

Uses `incrementalQuery` (not `query`) because it diffs results by row ID — efficient even during rapid sync writes where many rows change in quick succession.

**Subscription deduplication:** If multiple components mount with the same SQL/params, they should share a single PGlite subscription rather than creating duplicates. The hook uses a module-level subscription registry (keyed by SQL+params) with a reference count — first consumer creates the subscription, last unmounter destroys it (per `client-event-listeners` deduplication pattern).

#### 3. `useLiveNotes()` / `useLiveNotesByFolder(folderId)` / `useLiveCollaborativeNotes()`

Location: `src/hooks/useNotes.ts` (replaces existing `useQuery` calls)

Each is a thin wrapper around `useLiveQuery` with the appropriate SQL:

- `useLiveNotes()` — all notes, ordered by modified date
- `useLiveNotesByFolder(folderId)` — filtered by `metadata->>'folderId'`
- `useLiveCollaborativeNotes()` — filtered by `metadata->>'isCollaborative'`

#### 4. `useLiveFolders()`

Location: `src/hooks/useFolders.ts` (replaces existing `useQuery` call)

Live query on the `folders` table.

#### 5. Local-First Mutation Functions

Location: `src/hooks/useNotes.ts`, `src/hooks/useFolders.ts`

Mutations become plain async functions (no `useMutation` wrapper needed). The parent hooks (`useNotes`, `useFolders`) still export these as methods — the API shape stays the same for consumers, but the internal implementation drops `useMutation`, `onMutate`, `onError`, and `onSettled`. Components that need mutation loading state can use local `useState` (most don't need it — the live query update is near-instant).

- `deleteNote(docId)` — delete from PGlite → fire-and-forget remote delete (errors logged to sync_errors)
- `createNote(folderId?)` — insert into PGlite → create sync record as pending
- `updateMetadata(docId, metadata)` — update PGlite → mark sync record pending
- `togglePin(docId, isPinned)` — update PGlite → mark sync record pending
- `deleteFolder(folderId)` — delete folder + notes from PGlite → fire-and-forget remote delete (errors logged to sync_errors)

#### 6. `useJournalWebsocket` — Simplified

Remove `useQueryClient` import and all `invalidateQueries()` calls. Keep `WebSocketProcessQueue` and `handleRemoteNote()` / `handleRemoteFolder()` calls unchanged.

### What Gets Removed

- 10 `invalidateQueries({ queryKey: notesQueryKey })` call sites (8 in useNotes/useJournalWebsocket + 2 in useTags)
- 4 `invalidateQueries({ queryKey: foldersQueryKey })` call sites
- 4 `setQueryData` optimistic update handlers
- 4 `onError` rollback handlers
- `useQueryClient` from `useJournalWebsocket`
- `useMutation` wrappers for note/folder CRUD (replaced by plain async functions)

### What Gets Added

- `live` extension in PGlite worker config (1 line)
- `live` extension in test PGlite setup (1 line)
- `useLiveQuery()` generic hook (~40 lines) with `startTransition`, subscription deduplication, and primitive deps
- `useLiveNotes()`, `useLiveNotesByFolder()`, `useLiveCollaborativeNotes()` (thin wrappers)
- `useLiveFolders()` (thin wrapper)
- Local-first mutation functions
- Test helpers: `waitForEmission()`, `collectEmissions()`

## React Performance Patterns (Vercel Best Practices)

These patterns apply specifically to the live query integration:

### `startTransition` for subscription updates (`rerender-transitions`)

Live query emissions during heavy sync are non-urgent — the user isn't directly interacting with the sync. Wrapping `setState` inside `useLiveQuery` with `startTransition()` ensures that user interactions (typing in the editor, clicking sidebar) remain responsive even when the note list is rapidly updating. React can interrupt a pending list re-render to process the user's click.

### `useDeferredValue` for the note list (`rerender-use-deferred-value`)

The `NoteList` component sorts, groups by date, and filters notes on every render. During first-sync with 200+ notes streaming in, this re-computation on every emission could lag. Consumers should wrap the live query result with `useDeferredValue` before passing it to the expensive list renderer:

```ts
const { data: notes } = useLiveNotes();
const deferredNotes = useDeferredValue(notes);
// Pass deferredNotes to NoteList — React skips re-renders when a newer update arrives
```

This lets React drop intermediate renders during rapid updates — the list jumps from 10 to 15 to 25 notes instead of re-rendering at 10, 11, 12, 13... individually.

### Subscription deduplication (`client-event-listeners`)

Multiple components (NoteList, Sidebar badge, TabBar) may consume `useLiveNotes()`. Without deduplication, each mounts its own PGlite `live.incrementalQuery` subscription. The hook uses a module-level registry keyed by SQL+params with reference counting — one subscription per unique query, shared across all consumers.

### Primitive hook dependencies (`rerender-dependencies`)

`useLiveQuery(sql, params)` uses the SQL string and JSON-serialized params as effect dependencies — both primitives. This avoids re-establishing the subscription when the parent re-renders with a new (but identical) params object reference.

### No derived state in effects (`rerender-derived-state-no-effect`)

The live query result is used directly — not copied into separate state via `useEffect`. The subscription callback sets state once; any derived values (filtered notes, sorted notes, note count) are computed during render, not stored in additional state.

### `content-visibility: auto` for note list items (`rendering-content-visibility`)

During first-sync, the note list can grow to hundreds of items rapidly. Apply CSS `content-visibility: auto` with `contain-intrinsic-size` on note list items so the browser skips layout/paint for off-screen entries. This is a CSS-only optimization — no component changes needed.

```css
.note-list-item {
  content-visibility: auto;
  contain-intrinsic-size: auto 72px; /* estimated item height */
}
```

## Testing Strategy — TDD (Tests First)

All tests written and failing before implementation. Real in-memory PGlite with `live` extension — no mocks.

### Test File 1: `live_queries.test.ts` — Foundation

**`live.incrementalQuery` basics:**
- Emits initial result set on subscribe
- Emits updated results when a row is inserted
- Emits updated results when a row is updated
- Emits updated results when a row is deleted
- Does not emit when unrelated table changes
- Stops emitting after unsubscribe

**Incremental diffing behavior:**
- Returns full updated result set on each emission (not a diff)
- Internal diffing avoids re-parsing unchanged rows (perf optimization)
- Handles rapid sequential inserts (10 rows in <100ms) — each emission has correct cumulative state

**With `search_index` table:**
- Detects new note inserted via upsertSearchIndex pattern
- Detects note metadata update (title change)
- Detects note deletion
- Handles JSONB metadata column in results
- Filters by folderId in live query WHERE clause

**With `folders` table:**
- Detects new folder creation
- Detects folder rename
- Detects folder deletion

### Test File 2: `progressive_sync.test.ts` — Integration

**Pull phase — item-by-item visibility:**
- Live query emits after each upsertSearchIndex call
- Inserting 5 notes produces 5 emissions (one per note)
- Each emission contains all notes inserted so far (cumulative)
- Notes appear in correct sort order (by modified date)
- Folder-filtered live query only emits for matching folderId

**Pull phase — performance under load:**
- Handles 50 rapid inserts without missed emissions
- Handles 200 inserts (first-sync scenario) within 5s
- Concurrent folder + note inserts both trigger live queries

**Websocket path — unified with pull:**
- handleRemoteNote writes trigger live query emission
- handleDeletedNote removes note from live query results
- handleRemoteFolder writes trigger folder live query emission

### Test File 3: `local_first_mutations.test.ts` — Mutations

**Delete note:**
- Removes note from live query results after local delete
- Cleans up document_updates, search_index, sync_records
- Note disappears from results within 50ms of delete call
- Remote delete failure does not restore the note locally
- Remote delete failure logs to sync_errors table

**Create note:**
- New note appears in live query results after local insert
- Creates sync record with pending status
- Note appears in folder-filtered query with correct folderId

**Update metadata:**
- Title change reflected in live query results
- Folder move reflected in both source and target folder queries
- Pin toggle reflected in live query results
- Marks sync record as pending after metadata update

**Delete folder:**
- Folder removed from folder live query results
- Notes in deleted folder removed from notes live query
- Cannot delete Main folder

### Test File 4: `live_query_edge_cases.test.ts` — Resilience

**Subscription lifecycle:**
- Multiple subscribers receive same updates
- Unsubscribing one does not affect others
- Re-subscribing after unsubscribe gets fresh initial data
- No memory leak after repeated subscribe/unsubscribe cycles

**Subscription deduplication:**
- Two components using same SQL/params share one PGlite subscription (ref count = 2)
- Unmounting one component keeps subscription alive for the other
- Unmounting both destroys the subscription
- Different SQL/params create separate subscriptions

**Concurrent operations:**
- Simultaneous insert + delete produces correct final state
- Rapid update of same row coalesces into single emission
- Sync pull + local create at same time both appear

**Data integrity:**
- JSONB metadata survives round-trip through live query
- Empty plain_text_content handled correctly
- Unicode titles preserved in live query results
- Null metadata fields do not crash live query

**Collaborative notes filter:**
- Live query with isCollaborative filter returns only collab notes
- Marking note as collaborative adds it to collab live query
- Unmarking note removes it from collab live query

### Test Infrastructure Updates

- `testDb.ts`: Add `live` extension to test PGlite instance, export `createTestDatabaseWithLive()`
- Helper: `waitForEmission(callback, timeoutMs)` — resolves when live query emits
- Helper: `collectEmissions(query, count)` — collects N emissions into array for assertions
- Execution order: foundation → mutations → integration → edge cases

## Implementation Order

1. Add `live` extension to PGlite worker + test infrastructure
2. Write all test files (failing)
3. Implement `useLiveQuery()` generic hook
4. Implement `useLiveNotes()` / `useLiveFolders()` — make foundation + mutation tests pass
5. Restructure mutations to local-first — make mutation tests pass
6. Simplify `useJournalWebsocket` (remove invalidation) — make integration tests pass
7. Remove unused React Query imports/code from notes/folders hooks
8. Wire up sync progress threshold (>= 10 items shows progress bar)
9. Run edge case tests, fix any issues
10. Full manual testing: first sync, delta sync, websocket, create/delete/edit flows

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `live.incrementalQuery` perf with 200+ rapid writes | Test in step 2 explicitly. If slow, throttle sync writes with microtask batching |
| PGlite live + Worker interaction issues | Foundation tests (step 2) validate this before any refactoring |
| Mutation latency perceptible without optimistic updates | Test proves <50ms in step 3. PGlite worker roundtrip is ~5-15ms |
| Remote delete failure leaves orphan on server | sync_errors table tracks failures; next sync retry cleans up |
| Live query subscription memory leaks | Edge case tests validate subscribe/unsubscribe cycles |
