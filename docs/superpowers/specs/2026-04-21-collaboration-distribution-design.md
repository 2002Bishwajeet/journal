# Collaboration Distribution — Design Spec

> Date: 2026-04-21
> Scope: Invitation-based distribution for collaborative notes + peer websocket for live updates
> Branch: feat-collaboration
> Depends on: P0/P1/P2/P3 fixes already applied in this branch

---

## Problem

When User A marks a note as collaborative, the note's ACL is updated on User A's drive — but nothing is sent to circle members. User B has no mechanism to discover, receive, or access shared notes. The collaboration feature is one-sided.

## Solution

A lightweight **invitation file** distributed via Homebase transit acts as a pointer. The actual note content stays on the author's drive and is accessed over peer. A **peer WebSocket** subscription provides live updates when a shared note is actively open.

---

## 1. New Constants

```typescript
// In config.ts
COLLABORATION_INVITE_FILE_TYPE = 615  // JOURNAL_FILE_TYPE (605) + 10
COLLABORATION_INVITE_DATA_TYPE = 716  // JOURNAL_DATA_TYPE (706) + 10
```

## 2. Invitation Content Type

```typescript
interface CollaborationInviteContent {
    authorOdinId: string;      // Identity that owns the actual note
    noteUniqueId: string;      // UniqueId of the shared note on author's drive
    noteTitle: string;         // For preview in collaborative folder list
    notePreview: string;       // First ~150 chars for list rendering
    sharedAt: string;          // ISO timestamp
}
```

Circle/member info is not stored in the invitation — it comes from the actual note's ACL and transfer history when fetched over peer.

## 3. Sender Flow

### 3a. Marking as Collaborative

Inside `makeNoteCollaborative()`, after the existing `patchFile` that updates ACL:

1. Build `CollaborationInviteContent` from the note's current state
2. Check if an invitation file already exists for this `noteUniqueId` (using `getFileHeaderByUniqueId` with `COLLABORATION_INVITE_FILE_TYPE`)
3. **If exists:** `patchFile` to update content (reshare with different circles)
4. **If new:** `uploadFile` to create invitation with:
   - `fileType: COLLABORATION_INVITE_FILE_TYPE`
   - `dataType: COLLABORATION_INVITE_DATA_TYPE`
   - `uniqueId: noteUniqueId` (dedup — one invitation per note)
   - `groupId: COLLABORATIVE_FOLDER_ID`
   - `allowDistribution: true` (Homebase transit handles delivery)
   - `accessControlList: { requiredSecurityGroup: Connected, circleIdList: circleIds }`
   - `isEncrypted: true`

### 3b. Revoking Collaboration

Inside `revokeNoteCollaboration()`, after reverting the note's ACL:

1. Fetch the invitation file by `uniqueId: noteUniqueId` with `fileType: COLLABORATION_INVITE_FILE_TYPE`
2. `deleteFile()` to soft-delete it
3. Homebase transit propagates the deletion — recipients receive a `fileDeleted` notification

## 4. Receiver Flow

### 4a. Via WebSocket (Real-Time)

`useJournalWebsocket` already handles file notifications on `JOURNAL_DRIVE`. Extend the handler:

- **`fileAdded`/`fileModified` with fileType 615:**
  - Extract `CollaborationInviteContent` from notification header
  - Store in `search_index` with collaborative metadata (see 4c)
  - Show toast: "{authorOdinId} shared '{noteTitle}' with you"
  - Invalidate queries

- **`fileDeleted` with fileType 615:**
  - Extract `noteUniqueId` from the deleted file header
  - Remove from `search_index`
  - Clean up cached Yjs data from `document_updates`
  - Invalidate queries (note disappears from sidebar silently)

### 4b. Via Sync Pull (Catch-Up)

`InboxProcessor.processChanges()` currently separates results into `folders` and `notes` by fileType. Add a third bucket:

- `fileType === COLLABORATION_INVITE_FILE_TYPE` → push to `invitations` array
- Return `invitations` in `InboxProcessResult`
- `SyncService.pullChanges()` processes invitations:
  - Active invitations (fileState 0): store in search_index
  - Deleted invitations (fileState 1): remove from search_index + clean up Yjs cache

### 4c. Local Storage of Invitations

Insert into `search_index` with:

```
docId: noteUniqueId
title: inviteContent.noteTitle
plainTextContent: inviteContent.notePreview
metadata: {
    title: inviteContent.noteTitle,
    folderId: COLLABORATIVE_FOLDER_ID,
    tags: [],
    timestamps: { created: inviteContent.sharedAt, modified: inviteContent.sharedAt },
    excludeFromAI: true,
    isCollaborative: true,
    authorOdinId: inviteContent.authorOdinId,
}
```

The existing `useCollaborativeNotes()` query and sidebar "Shared with me" section render these automatically — they filter on `isCollaborative: true`.

### 4d. Opening a Shared Note

When User B clicks a collaborative note in the list:

1. `EditorPage` reads `metadata.authorOdinId` from the note
2. If `authorOdinId` differs from host identity → peer mode
3. Fetch note header via `getNote(noteUniqueId, authorOdinId)` → peer fetch
4. Fetch Yjs blob via `getNotePayload(fileId, authorOdinId)` → peer fetch
5. Cache Yjs blob in local `document_updates` table
6. Render in TipTap editor as normal
7. Edits saved via `updateNote(..., authorOdinId, globalTransitId)` → peer update

### 4e. Updating Local Cache on Peer Changes

When a peer WebSocket notification arrives for a note User B has cached:
1. Fetch updated Yjs blob via peer
2. Merge with local cache using `mergeYjsDocuments()` (Yjs CRDT)
3. Save merged state to `document_updates`
4. Broadcast to open editor via `documentBroadcast.notifyDocumentUpdated()`

## 5. Peer WebSocket for Active Collaborative Note

### 5a. Architecture

A new hook `usePeerNoteWebsocket` subscribes to the **author's** `JOURNAL_DRIVE` via `SubscribeOverPeer` when a collaborative note is open in the editor. Only active for the currently viewed note.

### 5b. Extending `useWebsocketSubscriber`

The existing hook only supports local subscriptions. Add `odinId` parameter matching the SDK pattern:

```typescript
export const useWebsocketSubscriber = (
    handler: ... | undefined,
    odinId: string | undefined,     // NEW — if set and differs from host, uses peer variants
    types: NotificationType[],
    drives: TargetDrive[],
    onDisconnect?: () => void,
    onReconnect?: () => void,
    refId?: string
) => {
    const isPeer = !!odinId && odinId !== dotYouClient.getHostIdentity();
    // If isPeer: use SubscribeOverPeer, UnsubscribeOverPeer, NotifyOverPeer
    // Else: use Subscribe, Unsubscribe, Notify (existing behavior)
};
```

Existing callers pass `undefined` for `odinId` — no breaking change.

### 5c. `usePeerNoteWebsocket` Hook

```typescript
usePeerNoteWebsocket({
    authorOdinId: string | undefined,
    noteUniqueId: string | undefined,
    isEnabled: boolean,
    syncService: SyncService | null,
})
```

- **Activates when:** `authorOdinId` is set, differs from host, note is open, `isEnabled` is true
- **Subscribes to:** author's `JOURNAL_DRIVE` via `SubscribeOverPeer`
- **Filters:** only processes notifications matching `noteUniqueId`
- **On `fileModified`:** fetches updated Yjs via peer → merges CRDT → reloads editor
- **On disconnect:** records timestamp for delta sync
- **On reconnect:** fetches latest version of the note to catch missed changes
- **On unmount:** `UnsubscribeOverPeer` — cleans up peer connection
- **Uses `NotifyOverPeer`** for `processInbox` replies (matching SDK pattern)

### 5d. Integration Point

`EditorPage` mounts `usePeerNoteWebsocket` when rendering a collaborative note:

```tsx
// Only active for peer notes
usePeerNoteWebsocket({
    authorOdinId: selectedNoteMetadata?.authorOdinId,
    noteUniqueId: noteId,
    isEnabled: isPeerNote,
    syncService,
});
```

### 5e. Vercel Best Practices Applied

- **`rerender-use-ref-transient-values`:** Handler stored in ref, synced via dedicated effect — avoids resubscription on every render
- **`rerender-move-effect-to-event`:** Reconnect delta-sync triggered in callback, not modeled as state + effect
- **`bundle-dynamic-imports`:** Peer websocket imports (`SubscribeOverPeer`, etc.) lazy-loaded since most users don't use collaboration
- **Stable references:** `drives` array and `types` array defined as module-level constants to prevent effect re-runs from array identity changes

## 6. Edge Cases

| Case | Handling |
|------|----------|
| User B offline when invited | Sync pull catches invitation on next online |
| User A reshares with different circles | `patchFile` updates existing invitation (same uniqueId) |
| User B in multiple shared circles | One invitation per note (uniqueId dedup), no duplicates |
| Author deletes note entirely | User B's peer fetch returns null — show "Note no longer available", clean up local entry |
| User B edits while User A revokes | Peer update fails (ACL revoked) — catch error, show toast, remove from local |
| Peer WebSocket disconnects | Records disconnect time, delta-syncs the single note on reconnect |
| Multiple collaborators editing | Yjs CRDT merges automatically — no manual conflict resolution needed |

## 7. Not In Scope

- Push notifications for collaborative edits (separate P4 effort)
- Conflict resolution UI (Yjs CRDT handles merges)
- Collaborative folders (V2 placeholder)
- Password-protected sharing (V2 placeholder)
- Read-only access level (all collaborators get full edit access via Connected ACL)
