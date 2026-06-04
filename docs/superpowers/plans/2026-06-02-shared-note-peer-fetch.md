# Shared Note Peer-Fetch (Local-First Fallback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When opening a shared/peer note, if there is no local content, fetch it once over peer, store it, and let the editor reload — turning today's silent blank into either rendered content or an actionable error.

**Architecture:** Local-first with peer fallback. A new `SyncService.ensurePeerNoteContent(docId, authorOdinId)` checks the local PGlite store first and only fetches over peer on a miss; a `usePeerNoteContent` hook drives it on open; `EditorPage` renders loading / typed-failure / retry states. Also makes the sync record's `authorOdinId` the source of truth in `handleRemoteNote` (removes a silent-fallback footgun).

**Tech Stack:** React 19, TypeScript, Vitest (real in-memory PGlite), Yjs, `@homebase-id/js-lib` (peer transit).

**Scope:** Spec items #1 (no peer fetch on open) + #2 (silent blank) + #3 (author-identity divergence). Out of scope (tracked as follow-ups at the end): #5 folder/`previousFolderId`, #6 peer WS handshake (`applyAppCircleGrants`), #8 reconnect storm, and removing the temporary `[PEER-DIAG]`/WS diagnostics.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/homebase/SyncService.ts` | Sync orchestration; add local-first peer-content fetch + author-id source-of-truth | Modify |
| `src/__tests__/peer_note_fetch.test.ts` | Unit tests for `ensurePeerNoteContent` + `handleRemoteNote` author-id | Create |
| `src/hooks/usePeerNoteContent.ts` | React lifecycle wrapper that calls `ensurePeerNoteContent` on open | Create |
| `src/components/editor/PeerNoteFallback.tsx` | Presentational loading / error+retry states for a peer note | Create |
| `src/pages/EditorPage.tsx` | Compose the hook + render fallback states | Modify |

---

## Task 1: `SyncService.ensurePeerNoteContent` (local-first peer fetch)

**Files:**
- Modify: `src/lib/homebase/SyncService.ts` (add `#hostIdentity` field + types + methods)
- Test: `src/__tests__/peer_note_fetch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/peer_note_fetch.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { saveDocumentUpdate, getDocumentUpdates, getSyncRecord } from '@/lib/db/queries';
import type { OnlineContextType } from '@/contexts/OnlineContext';

// Point getDatabase at the in-memory test DB (same pattern as sync_optimization.test.ts)
vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

// Stub the homebase providers so SyncService construction does no network
const { mockGetNote, mockGetNotePayload, mockDsr } = vi.hoisted(() => ({
    mockGetNote: vi.fn(),
    mockGetNotePayload: vi.fn(),
    mockDsr: vi.fn(),
}));
vi.mock('@/lib/homebase/NotesDriveProvider', () => ({
    NotesDriveProvider: vi.fn(() => ({
        getNote: mockGetNote,
        getNotePayload: mockGetNotePayload,
        dsrToNoteFileContent: mockDsr,
    })),
}));
vi.mock('@/lib/homebase/FolderDriveProvider', () => ({ FolderDriveProvider: vi.fn(() => ({})) }));
vi.mock('@/lib/homebase/InboxProcessor', () => ({ InboxProcessor: vi.fn(() => ({})) }));

import { documentBroadcast } from '@/lib/broadcast';
import { SyncService } from '@/lib/homebase/SyncService';

const HOST = 'sam.dotyou.cloud';
const FRODO = 'frodo.dotyou.cloud';
const DOC_ID = '11111111-1111-1111-1111-111111111111';

const fakeDotYouClient = { getHostIdentity: () => HOST } as unknown as DotYouClient;
const fakeOnline = { isOnline: true } as unknown as OnlineContextType;

function makePeerHeader() {
    return {
        fileId: 'remote-file-1',
        sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
        fileMetadata: { updated: 1700000000000, versionTag: 'v1', globalTransitId: 'gtid-1', appData: {} },
    };
}

describe('SyncService.ensurePeerNoteContent', () => {
    let db: PGlite;
    let svc: SyncService;
    let broadcastSpy: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
        db = await createTestDatabase();
        // @ts-expect-error test-only setter
        pgliteModule.setTestDb(db);
    });
    afterAll(async () => { await closeTestDatabase(); });
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        broadcastSpy = vi.spyOn(documentBroadcast, 'notifyDocumentUpdated').mockImplementation(() => {});
        svc = new SyncService(fakeDotYouClient, fakeOnline);
    });

    it('returns local without fetching when content already exists', async () => {
        await saveDocumentUpdate(DOC_ID, new Uint8Array([1, 2, 3]));
        const result = await svc.ensurePeerNoteContent(DOC_ID, FRODO);
        expect(result.status).toBe('local');
        expect(mockGetNote).not.toHaveBeenCalled();
        expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('returns local without fetching when authorOdinId is the host', async () => {
        const result = await svc.ensurePeerNoteContent(DOC_ID, HOST);
        expect(result.status).toBe('local');
        expect(mockGetNote).not.toHaveBeenCalled();
    });

    it('fetches, stores and broadcasts when local is empty', async () => {
        mockGetNote.mockResolvedValue(makePeerHeader());
        mockGetNotePayload.mockResolvedValue(new Uint8Array([9, 9, 9]));

        const result = await svc.ensurePeerNoteContent(DOC_ID, FRODO);

        expect(result.status).toBe('fetched');
        expect(mockGetNote).toHaveBeenCalledWith(DOC_ID, FRODO, { decrypt: true });
        const updates = await getDocumentUpdates(DOC_ID);
        expect(updates.length).toBe(1);
        const record = await getSyncRecord(DOC_ID);
        expect(record?.authorOdinId).toBe(FRODO);
        expect(record?.globalTransitId).toBe('gtid-1');
        expect(broadcastSpy).toHaveBeenCalledWith(DOC_ID);
    });

    it('returns forbidden on a 403 header error', async () => {
        mockGetNote.mockRejectedValue({ response: { status: 403 } });
        const result = await svc.ensurePeerNoteContent(DOC_ID, FRODO);
        expect(result.status).toBe('forbidden');
        expect((await getDocumentUpdates(DOC_ID)).length).toBe(0);
        expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('returns offline on a network error (no response)', async () => {
        mockGetNote.mockRejectedValue(new Error('Network Error'));
        const result = await svc.ensurePeerNoteContent(DOC_ID, FRODO);
        expect(result.status).toBe('offline');
    });

    it('returns empty when header is OK but payload is null', async () => {
        mockGetNote.mockResolvedValue(makePeerHeader());
        mockGetNotePayload.mockResolvedValue(null);
        const result = await svc.ensurePeerNoteContent(DOC_ID, FRODO);
        expect(result.status).toBe('empty');
        expect((await getDocumentUpdates(DOC_ID)).length).toBe(0);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- peer_note_fetch`
Expected: FAIL — `svc.ensurePeerNoteContent is not a function`.

- [ ] **Step 3: Add the `#hostIdentity` field and set it in the constructor**

In `src/lib/homebase/SyncService.ts`, add the field next to the other private fields (after `#onlineContext`):

```ts
    #onlineContext: OnlineContextType;
    #hostIdentity: string;
```

And set it in the constructor (after `this.#onlineContext = onlineContext;`):

```ts
        this.#onlineContext = onlineContext;
        this.#hostIdentity = dotYouClient.getHostIdentity();
```

- [ ] **Step 4: Add the result type + error classifier (module scope)**

Near the top of `src/lib/homebase/SyncService.ts`, after the `SyncResult` interface (around line 49), add:

```ts
export type EnsureNoteContentStatus =
    | 'local'      // served from local store; no network
    | 'fetched'    // fetched over peer and stored
    | 'offline'    // author unreachable (no HTTP response)
    | 'forbidden'  // 403 — no drive access
    | 'notfound'   // 404 — note/header gone
    | 'empty'      // header readable but no content payload
    | 'error';     // unclassified

export interface EnsureNoteContentResult {
    status: EnsureNoteContentStatus;
}

/** Map a peer-fetch error to a typed status. No HTTP response → offline. */
export function classifyPeerFetchError(err: unknown): Extract<
    EnsureNoteContentStatus,
    'forbidden' | 'notfound' | 'offline' | 'error'
> {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 403) return 'forbidden';
    if (status === 404) return 'notfound';
    if (status === undefined) return 'offline';
    return 'error';
}
```

- [ ] **Step 5: Implement `ensurePeerNoteContent` + `#fetchAndStorePeerNote`**

In the `SyncService` class (place after `getNoteProvider()`), add:

```ts
    /**
     * Local-first content load for a peer note. Returns immediately if local
     * content exists; otherwise fetches the note over peer, stores it, and
     * broadcasts so an open editor reloads.
     */
    async ensurePeerNoteContent(
        docId: string,
        authorOdinId: string | undefined,
    ): Promise<EnsureNoteContentResult> {
        // Not a peer note → nothing to fetch.
        if (!authorOdinId || authorOdinId === this.#hostIdentity) {
            return { status: 'local' };
        }
        // Local-first: existing content always wins.
        const localUpdates = await getDocumentUpdates(docId);
        if (localUpdates.length > 0) {
            return { status: 'local' };
        }
        return this.#fetchAndStorePeerNote(docId, authorOdinId);
    }

    async #fetchAndStorePeerNote(
        docId: string,
        authorOdinId: string,
    ): Promise<EnsureNoteContentResult> {
        let peerNote;
        try {
            peerNote = await this.#notesProvider.getNote(docId, authorOdinId, { decrypt: true });
        } catch (err) {
            return { status: classifyPeerFetchError(err) };
        }
        if (!peerNote || !peerNote.fileId) {
            return { status: 'notfound' };
        }

        let blob: Uint8Array | null;
        try {
            blob = await this.#notesProvider.getNotePayload(
                peerNote.fileId, authorOdinId, peerNote.fileMetadata.updated,
            );
        } catch (err) {
            return { status: classifyPeerFetchError(err) };
        }
        if (!blob) {
            return { status: 'empty' };
        }

        await saveDocumentUpdate(docId, blob);
        await upsertSyncRecord({
            localId: docId,
            entityType: 'note',
            remoteFileId: peerNote.fileId,
            versionTag: peerNote.fileMetadata.versionTag,
            lastSyncedAt: new Date().toISOString(),
            syncStatus: 'synced',
            encryptedKeyHeader: serializeKeyHeader(peerNote.sharedSecretEncryptedKeyHeader),
            authorOdinId,
            globalTransitId: peerNote.fileMetadata.globalTransitId || undefined,
        });
        documentBroadcast.notifyDocumentUpdated(docId);
        return { status: 'fetched' };
    }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test -- peer_note_fetch`
Expected: PASS — all 6 cases green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/homebase/SyncService.ts src/__tests__/peer_note_fetch.test.ts
git commit -m "feat(sync): local-first peer-note content fetch with typed status"
```

---

## Task 2: `usePeerNoteContent` hook

**Files:**
- Create: `src/hooks/usePeerNoteContent.ts`

- [ ] **Step 1: Write the hook**

Create `src/hooks/usePeerNoteContent.ts`:

```ts
import { useEffect, useState } from 'react';
import type { SyncService, EnsureNoteContentStatus } from '@/lib/homebase/SyncService';

export type PeerNoteContentStatus = EnsureNoteContentStatus | 'idle' | 'loading';

interface UsePeerNoteContentOptions {
    docId: string | undefined;
    authorOdinId: string | undefined;
    isEnabled: boolean;
    syncService: SyncService | null;
}

/**
 * Drives SyncService.ensurePeerNoteContent on open of a peer note.
 * Local-first: resolves to 'local' instantly when content already exists.
 */
export function usePeerNoteContent({
    docId,
    authorOdinId,
    isEnabled,
    syncService,
}: UsePeerNoteContentOptions) {
    const [status, setStatus] = useState<PeerNoteContentStatus>('idle');
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!isEnabled || !docId || !authorOdinId || !syncService) {
            setStatus('idle');
            return;
        }
        let cancelled = false;
        setStatus('loading');
        syncService
            .ensurePeerNoteContent(docId, authorOdinId)
            .then((result) => { if (!cancelled) setStatus(result.status); })
            .catch(() => { if (!cancelled) setStatus('error'); });
        return () => { cancelled = true; };
    }, [docId, authorOdinId, isEnabled, syncService, attempt]);

    return {
        status,
        isLoading: status === 'loading',
        // functional setState → stable without useCallback (rerender-functional-setstate)
        retry: () => setAttempt((n) => n + 1),
    };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePeerNoteContent.ts
git commit -m "feat(hooks): usePeerNoteContent — local-first peer fetch on open"
```

---

## Task 3: `PeerNoteFallback` component + EditorPage wiring

**Files:**
- Create: `src/components/editor/PeerNoteFallback.tsx`
- Modify: `src/pages/EditorPage.tsx`

- [ ] **Step 1: Create the fallback component**

Create `src/components/editor/PeerNoteFallback.tsx`:

```tsx
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PeerNoteContentStatus } from '@/hooks/usePeerNoteContent';

const MESSAGES: Partial<Record<PeerNoteContentStatus, string>> = {
    offline: "Can't reach the author to load this shared note. They may be offline.",
    forbidden: 'You no longer have access to this note.',
    notfound: 'This note no longer exists.',
    empty: 'This shared note has no content yet.',
    error: 'Something went wrong loading this shared note.',
};

export function isPeerContentFailure(status: PeerNoteContentStatus): boolean {
    return status in MESSAGES;
}

export function PeerNoteLoading() {
    return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            <p className="text-sm">Loading shared note…</p>
        </div>
    );
}

export function PeerNoteError({
    status,
    onRetry,
    onBack,
}: {
    status: PeerNoteContentStatus;
    onRetry: () => void;
    onBack: () => void;
}) {
    return (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 px-6 text-center">
            <p className="text-sm font-medium">{MESSAGES[status] ?? MESSAGES.error}</p>
            <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
                <Button variant="ghost" size="sm" onClick={onBack}>Back to list</Button>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Wire the hook + states into EditorPage**

In `src/pages/EditorPage.tsx`, add imports near the other hook imports:

```tsx
import { usePeerNoteContent } from "@/hooks/usePeerNoteContent";
import {
  PeerNoteLoading,
  PeerNoteError,
  isPeerContentFailure,
} from "@/components/editor/PeerNoteFallback";
```

In the `EditorPage` default export, immediately after the existing `usePeerNoteWebsocket({ ... })` call, add:

```tsx
  const peerContent = usePeerNoteContent({
    docId: noteId,
    authorOdinId: selectedNoteMetadata?.authorOdinId,
    isEnabled: isPeerNote,
    syncService,
  });
```

Then, replace the existing early returns block:

```tsx
  if (!noteId) {
    return null;
  }

  if (!selectedNoteMetadata) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm font-medium mb-3">Note not found</p>
        <Button variant="outline" size="sm" onClick={handleBackToNotes}>
          Back to list
        </Button>
      </div>
    );
  }
```

with:

```tsx
  if (!noteId) {
    return null;
  }

  if (!selectedNoteMetadata) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p className="text-sm font-medium mb-3">Note not found</p>
        <Button variant="outline" size="sm" onClick={handleBackToNotes}>
          Back to list
        </Button>
      </div>
    );
  }

  if (isPeerNote && peerContent.isLoading) {
    return <PeerNoteLoading />;
  }

  if (isPeerNote && isPeerContentFailure(peerContent.status)) {
    return (
      <PeerNoteError
        status={peerContent.status}
        onRetry={peerContent.retry}
        onBack={handleBackToNotes}
      />
    );
  }
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/PeerNoteFallback.tsx src/pages/EditorPage.tsx
git commit -m "feat(editor): fetch shared-note content on open with loading/error/retry"
```

---

## Task 4: `handleRemoteNote` — prefer the sync record's `authorOdinId` (#3)

Today `handleRemoteNote` derives the author from `senderOdinId || originalAuthor`, which can diverge from the canonical `authorOdinId` already stored on the sync record. When it does, `getNotePayload` silently falls back to a *local* fetch with the author's remote fileId and returns nothing. Prefer the stored record.

**Files:**
- Modify: `src/lib/homebase/SyncService.ts:501`
- Test: `src/__tests__/peer_note_fetch.test.ts` (add a case)

- [ ] **Step 1: Add the failing test**

Append inside `src/__tests__/peer_note_fetch.test.ts` (new `describe` block, reusing the same mocks/host constants):

```ts
import { upsertSyncRecord } from '@/lib/db/queries';

describe('SyncService.handleRemoteNote author identity', () => {
    let db: PGlite;
    let svc: SyncService;

    beforeAll(async () => {
        db = await createTestDatabase();
        // @ts-expect-error test-only setter
        pgliteModule.setTestDb(db);
    });
    afterAll(async () => { await closeTestDatabase(); });
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        vi.spyOn(documentBroadcast, 'notifyDocumentUpdated').mockImplementation(() => {});
        svc = new SyncService(fakeDotYouClient, fakeOnline);
    });

    it('uses the stored sync record authorOdinId over senderOdinId', async () => {
        // Existing record knows the true author is FRODO.
        await upsertSyncRecord({
            localId: DOC_ID,
            entityType: 'note',
            remoteFileId: 'remote-file-1',
            versionTag: 'v0',
            lastSyncedAt: new Date().toISOString(),
            syncStatus: 'synced',
            authorOdinId: FRODO,
        });
        mockDsr.mockResolvedValue({ title: 'T', tags: [] });
        mockGetNotePayload.mockResolvedValue(null);

        const remoteFile = {
            fileId: 'remote-file-1',
            sharedSecretEncryptedKeyHeader: { encryptionVersion: 1, type: 'aes', iv: 'aXY=', encryptedAesKey: 'aXY=' },
            fileMetadata: {
                versionTag: 'v1',
                updated: 1700000001000,
                senderOdinId: 'someone-else.dotyou.cloud',
                globalTransitId: 'gtid-2',
                appData: { uniqueId: DOC_ID, groupId: undefined },
            },
        } as never;

        await svc.handleRemoteNote(remoteFile);

        expect(mockGetNotePayload).toHaveBeenCalledWith('remote-file-1', FRODO, 1700000001000);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- peer_note_fetch`
Expected: FAIL — `getNotePayload` called with `'someone-else.dotyou.cloud'`, not `FRODO`.

- [ ] **Step 3: Implement the fix**

In `src/lib/homebase/SyncService.ts`, change the author derivation in `handleRemoteNote` (currently line 501):

```ts
        const authorOdinId = remoteFile.fileMetadata.senderOdinId || remoteFile.fileMetadata.originalAuthor;
```

to:

```ts
        const authorOdinId = existingRecord?.authorOdinId
            || remoteFile.fileMetadata.senderOdinId
            || remoteFile.fileMetadata.originalAuthor;
```

(`existingRecord` is already in scope from the `getSyncRecord(uniqueId)` call earlier in the method.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- peer_note_fetch`
Expected: PASS.

- [ ] **Step 5: Run the full suite to confirm no regressions**

Run: `npm run test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/homebase/SyncService.ts src/__tests__/peer_note_fetch.test.ts
git commit -m "fix(sync): prefer stored authorOdinId in handleRemoteNote"
```

---

## Follow-ups (NOT in this plan — tracked so they're not lost)

- **#4 (silent local fallback in `getNotePayload`)** — addressed indirectly by Task 4 making `authorOdinId` authoritative. A dedicated guard/log is deferred.
- **#5 Folder loss on collaborate/revoke** — `makeNoteCollaborative` moves to `COLLABORATIVE_FOLDER_ID` and `revokeNoteCollaboration` hardcodes `MAIN_FOLDER_ID`; no `previousFolderId` is tracked. Separate plan.
- **#6 Peer WebSocket handshake** — server builds the peer-notification context with `applyAppCircleGrants: false` (DotYouCore `CircleNetworkService.cs:118`), so app-circle-grant Read is excluded and the handshake closes. Separate fix (scoped server change vs circle-definition grant).
- **#8 Reconnect storm (1006)** — SDK reconnect race in `WebsocketProviderOverPeer`. Separate SDK hardening.
- **Diagnostics cleanup** — remove the temporary `[PEER-DIAG]` logging (`NotesDriveProvider.getNote`/`getNotePayload`, `SyncService.bootstrapCollaborativeNote`) and the WebSocket `Proxy` + forced-token-clear in `useWebsocketSubscriber.ts` once the fetch path is verified end-to-end with the frodo→sam repro.

---

## Self-Review

- **Spec coverage:** #1 (no fetch on open) → Task 1+3; #2 (silent blank) → Task 1 typed statuses + Task 3 error/retry UX; #3 (author-id divergence) → Task 4. The spec's "refactor bootstrap to reuse one fetch path" is intentionally narrowed: `ensurePeerNoteContent` is self-contained to avoid regressing the working invite/bootstrap path; the duplication is ~12 lines and isolated. Flag for reviewer.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `EnsureNoteContentStatus`/`EnsureNoteContentResult` defined in Task 1 and consumed by `usePeerNoteContent` (Task 2) and `PeerNoteFallback` (Task 3); `PeerNoteContentStatus` extends it with `idle`/`loading`. `ensurePeerNoteContent(docId, authorOdinId)` signature matches across hook + tests. `classifyPeerFetchError` returns a subset of the status union.
