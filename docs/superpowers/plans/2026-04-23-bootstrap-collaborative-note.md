# Bootstrap Collaborative Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user receives a collaboration invitation, fetch the actual note over peer and create a full sync record so that subsequent edits route through `patchFile(locale: 'peer')` back to the author's identity.

**Architecture:** Extract the peer-fetch + sync-record + search-index logic into a new private method `bootstrapCollaborativeNote` on `SyncService`. `handleInvitation` calls it after parsing the invitation content. The method mirrors the "new note" branch of `handleRemoteNote` but fetches the note header over peer using `uniqueId` + `authorOdinId` from the invitation (since invitations don't carry `fileId`/`globalTransitId`). On peer-fetch failure, falls back to invitation-only search index (current behavior) so the note still appears in the list.

**Tech Stack:** TypeScript, Homebase SDK (`getNote`, `getNotePayload`), PGlite (sync records, search index, document updates)

---

### Task 1: Add `bootstrapCollaborativeNote` private method

**Files:**
- Modify: `src/lib/homebase/SyncService.ts:357-383`

- [ ] **Step 1: Add the `bootstrapCollaborativeNote` method after `handleInvitation`**

Add this new private method at line ~384 (after `handleInvitation`'s closing brace, before `handleDeletedInvitation`):

```typescript
private async bootstrapCollaborativeNote(
    noteUniqueId: string,
    authorOdinId: string,
    inviteTitle: string,
    invitePreview: string,
    sharedAt: string,
): Promise<void> {
    const peerNote = await this.#notesProvider.getNote(noteUniqueId, authorOdinId, { decrypt: true });
    if (!peerNote || !peerNote.fileId) {
        console.warn(`[SyncService] Could not fetch peer note ${noteUniqueId} from ${authorOdinId} — author may be offline`);
        await upsertSearchIndex({
            docId: noteUniqueId,
            title: inviteTitle,
            plainTextContent: invitePreview,
            metadata: {
                title: inviteTitle,
                folderId: COLLABORATIVE_FOLDER_ID,
                tags: [],
                timestamps: { created: sharedAt, modified: sharedAt },
                excludeFromAI: true,
                isCollaborative: true,
                authorOdinId,
            },
        });
        return;
    }

    const content = await this.#notesProvider.dsrToNoteFileContent(peerNote, true);
    const noteTitle = content?.title || inviteTitle || 'Untitled';

    const lastModified = peerNote.fileMetadata.updated;
    const remoteBlob = await this.#notesProvider.getNotePayload(peerNote.fileId, authorOdinId, lastModified);

    // async-parallel: saveDocumentUpdate and extractPreviewTextFromYjs are independent — run in parallel
    const [, plainTextContent] = await Promise.all([
        remoteBlob ? saveDocumentUpdate(noteUniqueId, remoteBlob) : Promise.resolve(),
        remoteBlob
            ? extractPreviewTextFromYjs(noteUniqueId, remoteBlob)
            : Promise.resolve(invitePreview),
    ]);

    const remoteTimestamp = new Date(
        peerNote.fileMetadata.appData.userDate || Date.now()
    ).toISOString();
    const updatedAt = new Date(peerNote.fileMetadata.updated).toISOString();

    const metadata = {
        title: noteTitle,
        folderId: COLLABORATIVE_FOLDER_ID,
        tags: content?.tags || [],
        timestamps: { created: remoteTimestamp, modified: updatedAt },
        excludeFromAI: content?.excludeFromAI,
        isPinned: content?.isPinned,
        isCollaborative: true,
        circleIds: content?.circleIds,
        recipients: content?.recipients,
        lastEditedBy: content?.lastEditedBy,
        authorOdinId,
    };

    const contentHash = remoteBlob ? await computeContentHash(metadata, remoteBlob) : undefined;

    // async-parallel: search index and sync record upserts are independent
    await Promise.all([
        upsertSearchIndex({
            docId: noteUniqueId,
            title: noteTitle,
            plainTextContent,
            metadata,
        }),
        upsertSyncRecord({
            localId: noteUniqueId,
            entityType: 'note',
            remoteFileId: peerNote.fileId,
            versionTag: peerNote.fileMetadata.versionTag,
            lastSyncedAt: new Date().toISOString(),
            syncStatus: 'synced',
            encryptedKeyHeader: serializeKeyHeader(peerNote.sharedSecretEncryptedKeyHeader),
            contentHash,
            authorOdinId,
            globalTransitId: peerNote.fileMetadata.globalTransitId || undefined,
        }),
    ]);
}
```

- [ ] **Step 2: Verify no compilation errors**

Run: `npx tsc --noEmit`
Expected: no errors related to SyncService.ts

---

### Task 2: Update `handleInvitation` to call `bootstrapCollaborativeNote`

**Files:**
- Modify: `src/lib/homebase/SyncService.ts:357-383`

- [ ] **Step 1: Replace the search-index-only logic in `handleInvitation` with a call to `bootstrapCollaborativeNote`**

Replace the current `handleInvitation` body (lines 357-383) with:

```typescript
async handleInvitation(remoteFile: HomebaseFile<string>): Promise<void> {
    const content = await this.#notesProvider.dsrToNoteFileContent(remoteFile, true) as unknown as CollaborationInviteContent | null;
    if (!content || !content.noteUniqueId) {
        console.error('[SyncService] Invalid invitation file', remoteFile.fileId);
        return;
    }

    await this.bootstrapCollaborativeNote(
        content.noteUniqueId,
        content.authorOdinId,
        content.noteTitle,
        content.notePreview,
        content.sharedAt,
    );
}
```

- [ ] **Step 2: Verify no compilation errors**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/homebase/SyncService.ts
git commit -m "feat: bootstrap collaborative note with sync record on invitation

Extract bootstrapCollaborativeNote() to fetch the peer note, save Yjs
content locally, and create a full sync record so pushNote routes
edits back to the author via patchFile(locale: 'peer')."
```

---

### Task 3: Add unit test for `bootstrapCollaborativeNote` flow

**Files:**
- Modify: `src/__tests__/sync.test.ts`

- [ ] **Step 1: Add test for invitation → sync record creation**

Add a new describe block at the end of `sync.test.ts` that tests the database operations `bootstrapCollaborativeNote` performs — upsert search index with collaborative metadata and upsert sync record with peer identifiers:

```typescript
describe('Collaborative Note Bootstrap (DB layer)', () => {
    it('should create sync record with peer identifiers for collaborative note', async () => {
        const noteId = generateTestId();
        const authorOdinId = 'frodo.hobbit.me';
        const remoteFileId = generateTestId();
        const globalTransitId = generateTestId();
        const versionTag = generateTestId();

        await upsertSyncRecord({
            localId: noteId,
            entityType: 'note',
            remoteFileId,
            versionTag,
            lastSyncedAt: new Date().toISOString(),
            syncStatus: 'synced',
            contentHash: 'abc123',
            encryptedKeyHeader: '{}',
            authorOdinId,
            globalTransitId,
        });

        const record = await getSyncRecord(noteId);
        expect(record).not.toBeNull();
        expect(record!.remoteFileId).toBe(remoteFileId);
        expect(record!.authorOdinId).toBe(authorOdinId);
        expect(record!.globalTransitId).toBe(globalTransitId);
        expect(record!.syncStatus).toBe('synced');
        expect(record!.versionTag).toBe(versionTag);
    });

    it('should allow pushNote to find peer identifiers after bootstrap', async () => {
        const noteId = generateTestId();
        const authorOdinId = 'sam.hobbit.me';
        const remoteFileId = generateTestId();
        const globalTransitId = generateTestId();

        // Simulate what bootstrapCollaborativeNote does
        await upsertSyncRecord({
            localId: noteId,
            entityType: 'note',
            remoteFileId,
            versionTag: generateTestId(),
            lastSyncedAt: new Date().toISOString(),
            syncStatus: 'synced',
            authorOdinId,
            globalTransitId,
        });

        // Simulate what happens when user edits — status goes to pending
        await markSynced(noteId, remoteFileId, generateTestId());
        const record = await getSyncRecord(noteId);

        // pushNote needs these to route via peer
        expect(record!.remoteFileId).toBe(remoteFileId);
        expect(record!.authorOdinId).toBe(authorOdinId);
        expect(record!.globalTransitId).toBe(globalTransitId);
    });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test -- src/__tests__/sync.test.ts`
Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/sync.test.ts
git commit -m "test: add collaborative note bootstrap sync record tests"
```
