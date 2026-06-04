# Shared Note Peer-Fetch (Local-First Fallback) — Design

- **Date:** 2026-06-02
- **Branch:** `feat-collaboration`
- **Status:** Design approved (Approach A); pending spec review

## Problem

Opening a shared/collaborative note — route `/shared/:id`, which renders `EditorPage`
with a peer `authorOdinId` — loads content **only** from the local PGlite store via
`PGliteProvider(docId, yDoc).load()`. Local content for a peer note is populated solely by:

1. `bootstrapCollaborativeNote` — one-shot, when the invitation arrives during `pullChanges`.
2. The peer WebSocket (`handleRemoteNote`) — currently broken (separate issue).

If bootstrap never ran or its peer fetch failed, the note opens **blank with no recovery** —
clicking it again just reloads empty local state. There is no peer fetch on open, and
`syncNote` is push-only (`pushNote`).

**Repro:** frodo shares a note to sam → sam opens `/shared/<id>` → content is blank.

## Goal

**Local-first with peer fallback.** On opening a peer note, if there is no local content,
fetch it once over peer, store it locally, and let the editor reload. Local content always
wins; the network is touched only on a true miss.

## Non-goals

- Fixing the peer WebSocket reconnect/handshake (tracked separately).
- Background refresh / freshness checks when local content already exists (that stays the
  WebSocket's job).
- Any broader sync re-architecture.

## Architecture (Approach A)

Three units with single responsibilities; reuses existing primitives
(`getDocumentUpdates`, `saveDocumentUpdate`, `documentBroadcast`, the provider's peer
`getNote`/`getNotePayload`). Honors the CLAUDE.md rule *"pages only compose; logic goes in hooks."*

### 1. `SyncService.ensurePeerNoteContent(docId, authorOdinId): Promise<EnsureResult>`

Local-first orchestration (public method):

- `authorOdinId` empty or equals host identity → `{ status: 'local' }` (not a peer note).
- `getDocumentUpdates(docId)` non-empty → `{ status: 'local' }`. **No network.**
- Else → private `#fetchAndStorePeerNote(docId, authorOdinId)`:
  - `getNote(docId, authorOdinId, { decrypt: true })` → header.
  - No header/fileId → classify and return `{status:'offline'|'forbidden'|'notfound'}`.
  - `getNotePayload(header.fileId, authorOdinId, header.fileMetadata.updated)` → blob.
  - Blob `null` → `{ status: 'empty' }` (nothing saved).
  - `saveDocumentUpdate(docId, blob)` + `upsertSyncRecord({ authorOdinId, globalTransitId,
    remoteFileId, versionTag, encryptedKeyHeader, syncStatus:'synced' })` +
    `documentBroadcast.notifyDocumentUpdated(docId)`.
  - `{ status: 'fetched' }`.

Error classification from axios `error.response?.status`: `403 → forbidden`,
`404 → notfound`, no response → `offline`, otherwise → `error`.

`bootstrapCollaborativeNote` is refactored to call `#fetchAndStorePeerNote`, so there is a
single fetch+save path (removes the current duplication).

```
type EnsureStatus =
  | 'local'      // served from local store, no network
  | 'fetched'    // fetched over peer and stored
  | 'offline'    // author unreachable
  | 'forbidden'  // 403 — no drive access
  | 'notfound'   // 404 — note/header gone
  | 'empty'      // header readable but no content payload
  | 'error';     // unclassified
type EnsureResult = { status: EnsureStatus };
```

### 2. Hook: `usePeerNoteContent({ docId, authorOdinId, isEnabled, syncService })`

React lifecycle wrapper. On mount and when `docId`/`authorOdinId` change (while `isEnabled`),
calls `ensurePeerNoteContent`. Cancellation guard ignores results after unmount/route-change.
Exposes `{ status, isLoading, error, retry }`.

### 3. `EditorPage`

Derives `isPeerNote` (existing). Consumes the hook and renders:
- spinner while loading and local is empty;
- the editor on `local`/`fetched`;
- a typed message + **Retry** on `offline`/`forbidden`/`notfound`/`empty`/`error`.

### Data flow on `/shared/:id`

```
EditorPage mount
  → usePeerNoteContent
    → SyncService.ensurePeerNoteContent
      → getDocumentUpdates(docId)         // local check
        → (miss) getNote + getNotePayload // peer fetch
          → saveDocumentUpdate + notifyDocumentUpdated
            → EditorProvider useDocumentSubscription → PGliteProvider.load()
              → content renders
```

## Error / UX states

| status | UX |
|---|---|
| `local` / `fetched` | render editor |
| `offline` | "Can't reach {author} to load this shared note." + Retry |
| `forbidden` | "You no longer have access to this note." |
| `notfound` | "This note no longer exists." |
| `empty` | "This shared note has no content yet." |
| `error` | generic error + Retry |

## Test plan (TDD — tests written first)

**File:** `src/__tests__/peer_note_fetch.test.ts`

**Harness:** real in-memory PGlite (`createTestDatabase` / `resetTestDatabase` /
`closeTestDatabase`); `vi.mock('@/lib/db/pglite')` to point `getDatabase` at the test DB
(existing pattern); `vi.mock('@/lib/homebase/NotesDriveProvider')` to stub `getNote`,
`getNotePayload`, `dsrToNoteFileContent`; spy `documentBroadcast.notifyDocumentUpdated`.
Construct `new SyncService(fakeDotYouClient, fakeOnlineContext)`.

Cases for `ensurePeerNoteContent`:

1. **Local content present** → `getNote` not called; `{status:'local'}`; no broadcast.
2. **Local empty + header & payload OK** → `document_updates` row written; sync record
   upserted with `authorOdinId`/`globalTransitId`; broadcast fired; `{status:'fetched'}`.
3. **Local empty + header throws 403** → `{status:'forbidden'}`; nothing saved/broadcast.
4. **Local empty + network error (no `response`)** → `{status:'offline'}`.
5. **Local empty + header OK + payload `null`** → `{status:'empty'}`; nothing saved.
6. **`authorOdinId === host`** → `{status:'local'}`; no network.

Optional (only if `renderHook`/`@testing-library/react` is already configured): a light
`usePeerNoteContent` test — invokes ensure on mount, transitions `isLoading → status`,
`retry` re-invokes.

## Risks & notes

- If the underlying failure is **403** (recipient lacks the drive grant), this fix does not
  grant access — but it surfaces the failure cleanly (`forbidden` + message) instead of a
  silent blank, and is the right place to recover once the permission/WS work lands.
- Only fetches when local is empty, so there is no Yjs merge concern here (no double-apply).
- **Cleanup:** remove the temporary `[PEER-DIAG]` logging (NotesDriveProvider, SyncService)
  and the WebSocket Proxy diagnostic (useWebsocketSubscriber.ts) once this is verified, or
  gate them behind a debug flag.
