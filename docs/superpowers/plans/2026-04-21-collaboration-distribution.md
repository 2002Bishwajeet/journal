# Collaboration Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable collaborative note distribution via invitation files so circle members can discover, receive, and edit shared notes — plus peer WebSocket for live updates on active notes.

**Architecture:** A lightweight invitation file (fileType 615) distributed via Homebase transit acts as a pointer to the actual note on the author's drive. Recipients store the invitation locally, then fetch/edit the note over peer. A peer WebSocket subscription provides live updates when a shared note is actively open in the editor.

**Tech Stack:** Homebase JS SDK (uploadFile, patchFile, deleteFile, SubscribeOverPeer), PGlite, TanStack Query, React, Yjs

**Spec:** `docs/superpowers/specs/2026-04-21-collaboration-distribution-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/homebase/config.ts` | Modify | Add invite file/data type constants |
| `src/types/index.ts` | Modify | Add `CollaborationInviteContent` type, `authorOdinId` to `DocumentMetadata` |
| `src/lib/homebase/NotesDriveProvider.ts` | Modify | Add `createInvitation`, `deleteInvitation` methods; update `makeNoteCollaborative` and `revokeNoteCollaboration` |
| `src/lib/homebase/InboxProcessor.ts` | Modify | Add `invitations` bucket to `processChanges` |
| `src/lib/homebase/SyncService.ts` | Modify | Process invitations in `pullChanges`; add `handleInvitation`/`handleDeletedInvitation` |
| `src/hooks/useJournalWebsocket.ts` | Modify | Handle invitation fileType in notification processing |
| `src/hooks/useWebsocketSubscriber.ts` | Modify | Add `odinId` parameter for peer subscribe/unsubscribe |
| `src/hooks/usePeerNoteWebsocket.ts` | Create | Peer WebSocket hook for active collaborative note |
| `src/pages/EditorPage.tsx` | Modify | Mount peer WebSocket for collaborative notes |
| `src/__tests__/database.test.ts` | Modify | Test invitation storage/retrieval |

---

### Task 1: Constants & Types

**Files:**
- Modify: `src/lib/homebase/config.ts`
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add invitation constants to config.ts**

Add after the `FOLDER_DATA_TYPE` line in `src/lib/homebase/config.ts`:

```typescript
export const COLLABORATION_INVITE_FILE_TYPE = 615; // JOURNAL_FILE_TYPE + 10
export const COLLABORATION_INVITE_DATA_TYPE = 716; // JOURNAL_DATA_TYPE + 10
```

- [ ] **Step 2: Add CollaborationInviteContent type and authorOdinId to DocumentMetadata**

In `src/types/index.ts`, add after the `NoteFileContent` interface:

```typescript
export interface CollaborationInviteContent {
    authorOdinId: string;
    noteUniqueId: string;
    noteTitle: string;
    notePreview: string;
    sharedAt: string;
}
```

Add `authorOdinId` to `DocumentMetadata` (after the `lastEditedBy` field):

```typescript
    authorOdinId?: string;     // Identity that owns the note (for peer fetch)
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 2: Sender — Create & Delete Invitation in NotesDriveProvider

**Files:**
- Modify: `src/lib/homebase/NotesDriveProvider.ts`

- [ ] **Step 1: Add imports for new constants**

In `src/lib/homebase/NotesDriveProvider.ts`, update the config import:

```typescript
import {
    JOURNAL_DRIVE,
    JOURNAL_FILE_TYPE,
    JOURNAL_DATA_TYPE,
    PAYLOAD_KEY_CONTENT,
    PAYLOAD_KEY_IMAGE_PREFIX,
    COLLABORATION_INVITE_FILE_TYPE,
    COLLABORATION_INVITE_DATA_TYPE,
    COLLABORATIVE_FOLDER_ID,
} from './config';
import type { NoteFileContent, DocumentMetadata, CollaborationInviteContent } from '@/types';
```

- [ ] **Step 2: Add createInvitation method**

Add to the `NotesDriveProvider` class, after `revokeNoteCollaboration`:

```typescript
    async createOrUpdateInvitation(
        noteUniqueId: string,
        noteTitle: string,
        notePreview: string,
        circleIds: string[],
        authorOdinId: string,
    ): Promise<void> {
        const inviteContent: CollaborationInviteContent = {
            authorOdinId,
            noteUniqueId,
            noteTitle,
            notePreview: notePreview.slice(0, 150),
            sharedAt: new Date().toISOString(),
        };

        const existingInvite = await getFileHeaderByUniqueId(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            noteUniqueId,
            { decrypt: false }
        );

        if (existingInvite && existingInvite.fileMetadata.appData.fileType === COLLABORATION_INVITE_FILE_TYPE) {
            const uploadMetadata: UploadFileMetadata = {
                versionTag: existingInvite.fileMetadata.versionTag,
                allowDistribution: true,
                appData: {
                    fileType: COLLABORATION_INVITE_FILE_TYPE,
                    dataType: COLLABORATION_INVITE_DATA_TYPE,
                    uniqueId: noteUniqueId,
                    groupId: COLLABORATIVE_FOLDER_ID,
                    content: JSON.stringify(inviteContent),
                },
                isEncrypted: true,
                accessControlList: {
                    requiredSecurityGroup: SecurityGroupType.Connected,
                    circleIdList: circleIds,
                },
            };

            const updateInstructions: UpdateInstructionSet = {
                locale: 'local',
                file: { fileId: existingInvite.fileId, targetDrive: JOURNAL_DRIVE },
                versionTag: existingInvite.fileMetadata.versionTag,
            };

            await patchFile(
                this.#dotYouClient,
                existingInvite.sharedSecretEncryptedKeyHeader,
                updateInstructions,
                uploadMetadata,
            );
        } else {
            const uploadMetadata: UploadFileMetadata = {
                allowDistribution: true,
                appData: {
                    fileType: COLLABORATION_INVITE_FILE_TYPE,
                    dataType: COLLABORATION_INVITE_DATA_TYPE,
                    uniqueId: noteUniqueId,
                    groupId: COLLABORATIVE_FOLDER_ID,
                    content: JSON.stringify(inviteContent),
                },
                isEncrypted: true,
                accessControlList: {
                    requiredSecurityGroup: SecurityGroupType.Connected,
                    circleIdList: circleIds,
                },
            };

            const instructionSet: UploadInstructionSet = {
                transferIv: getRandom16ByteArray(),
                storageOptions: { drive: JOURNAL_DRIVE },
            };

            await uploadFile(
                this.#dotYouClient,
                instructionSet,
                uploadMetadata,
                [],
                [],
                true,
            );
        }
    }
```

- [ ] **Step 3: Add deleteInvitation method**

Add after `createOrUpdateInvitation`:

```typescript
    async deleteInvitation(noteUniqueId: string): Promise<void> {
        const existingInvite = await getFileHeaderByUniqueId(
            this.#dotYouClient,
            JOURNAL_DRIVE,
            noteUniqueId,
            { decrypt: false }
        );

        if (existingInvite && existingInvite.fileMetadata.appData.fileType === COLLABORATION_INVITE_FILE_TYPE) {
            await deleteFile(this.#dotYouClient, JOURNAL_DRIVE, existingInvite.fileId);
        }
    }
```

- [ ] **Step 4: Wire into makeNoteCollaborative**

In `makeNoteCollaborative`, after the existing `patchFile` call that returns `{ versionTag }` (~line 708), add before the return:

```typescript
        // Distribute invitation to circle members via transit
        const preview = ''; // Preview will be populated from Yjs on next sync
        await this.createOrUpdateInvitation(
            uniqueId,
            existingContent?.title || '',
            preview,
            circleIds,
            editorOdinId,
        );
```

- [ ] **Step 5: Wire into revokeNoteCollaboration**

In `revokeNoteCollaboration`, after the existing `patchFile` call (~line 789), add before the return:

```typescript
        // Delete invitation — transit propagates deletion to recipients
        await this.deleteInvitation(uniqueId);
```

- [ ] **Step 6: Remove dynamic import of COLLABORATIVE_FOLDER_ID in makeNoteCollaborative**

Since we now import `COLLABORATIVE_FOLDER_ID` at the top of the file, remove the dynamic import line inside `makeNoteCollaborative`:

```typescript
// Remove this line:
const { COLLABORATIVE_FOLDER_ID } = await import('./config');
```

Do the same in `revokeNoteCollaboration` for `MAIN_FOLDER_ID` — import it at the top instead:

Add to the config import:
```typescript
    MAIN_FOLDER_ID,
```

Remove from `revokeNoteCollaboration`:
```typescript
// Remove this line:
const { MAIN_FOLDER_ID } = await import('./config');
```

- [ ] **Step 7: Verify TypeScript and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/homebase/NotesDriveProvider.ts`
Expected: No errors

---

### Task 3: Receiver — InboxProcessor Invitation Bucket

**Files:**
- Modify: `src/lib/homebase/InboxProcessor.ts`

- [ ] **Step 1: Add import and update interface**

Add to imports in `src/lib/homebase/InboxProcessor.ts`:

```typescript
import {
    JOURNAL_DRIVE,
    JOURNAL_FILE_TYPE,
    FOLDER_FILE_TYPE,
    COLLABORATION_INVITE_FILE_TYPE,
} from './config';
```

Update `InboxProcessResult`:

```typescript
export interface InboxProcessResult {
    folders: (HomebaseFile<string> | DeletedHomebaseFile)[];
    notes: (HomebaseFile<string> | DeletedHomebaseFile)[];
    invitations: (HomebaseFile<string> | DeletedHomebaseFile)[];
    processedresult: ProcessInboxResponse;
}
```

- [ ] **Step 2: Add invitation bucket to processChanges**

In `processChanges`, update the `findChangesSince` call to include the new file type:

```typescript
        const results = await this.findChangesSince(
            [FOLDER_FILE_TYPE, JOURNAL_FILE_TYPE, COLLABORATION_INVITE_FILE_TYPE],
            sinceTime,
        );
```

Add `invitations` to the arrays:

```typescript
        const folders: (HomebaseFile<string> | DeletedHomebaseFile)[] = [];
        const notes: (HomebaseFile<string> | DeletedHomebaseFile)[] = [];
        const invitations: (HomebaseFile<string> | DeletedHomebaseFile)[] = [];
```

Add the invitation case in the loop:

```typescript
            if (fileType === FOLDER_FILE_TYPE) {
                folders.push(item as HomebaseFile<string> | DeletedHomebaseFile);
            } else if (fileType === JOURNAL_FILE_TYPE) {
                notes.push(item as HomebaseFile<string> | DeletedHomebaseFile);
            } else if (fileType === COLLABORATION_INVITE_FILE_TYPE) {
                invitations.push(item as HomebaseFile<string> | DeletedHomebaseFile);
            }
```

Update the return:

```typescript
        return {
            folders,
            notes,
            invitations,
            processedresult,
        };
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

---

### Task 4: Receiver — SyncService Invitation Processing

**Files:**
- Modify: `src/lib/homebase/SyncService.ts`

- [ ] **Step 1: Add imports**

Add to the imports from `@/lib/db`:

```typescript
import { deleteDocumentUpdates } from '@/lib/db';
```

(Already imported — verify it's there.)

Add to the config imports if not already present:

```typescript
import { COLLABORATIVE_FOLDER_ID, COLLABORATION_INVITE_FILE_TYPE } from './config';
```

Add type import:

```typescript
import type { CollaborationInviteContent } from '@/types';
```

- [ ] **Step 2: Update pullChanges to process invitations**

In `pullChanges`, update the destructuring of `processChanges` result:

```typescript
        const { folders, notes, invitations } = await this.#inboxProcessor.processChanges(lastSync || undefined);
```

Update the total count:

```typescript
        const total = folders.length + notes.length + invitations.length;
```

After the notes processing loop (before the `return`), add invitation processing:

```typescript
        // Process invitations (collaboration sharing)
        for (const invitationOrDeleted of invitations) {
            try {
                if (invitationOrDeleted.fileState === 'deleted') {
                    await this.handleDeletedInvitation(invitationOrDeleted as DeletedHomebaseFile);
                } else {
                    await this.handleInvitation(invitationOrDeleted);
                }
                current++;
                if (onProgress) onProgress({ phase: 'pull', current, total, message: `Processing invitation ${current}/${total}` });
            } catch (error) {
                console.error('[SyncService] Error processing invitation:', error);
            }
        }
```

- [ ] **Step 3: Implement handleInvitation**

Add to the `SyncService` class after `handleDeletedFolder`:

```typescript
    async handleInvitation(remoteFile: HomebaseFile<string>): Promise<void> {
        const content = await this.#notesProvider.dsrToNoteFileContent(remoteFile, true) as unknown as CollaborationInviteContent | null;
        if (!content || !content.noteUniqueId) {
            console.error('[SyncService] Invalid invitation file', remoteFile.fileId);
            return;
        }

        const metadata = {
            title: content.noteTitle,
            folderId: COLLABORATIVE_FOLDER_ID,
            tags: [] as string[],
            timestamps: {
                created: content.sharedAt,
                modified: content.sharedAt,
            },
            excludeFromAI: true,
            isCollaborative: true,
            authorOdinId: content.authorOdinId,
        };

        await upsertSearchIndex({
            docId: content.noteUniqueId,
            title: content.noteTitle,
            plainTextContent: content.notePreview,
            metadata,
        });
    }
```

- [ ] **Step 4: Implement handleDeletedInvitation**

Add after `handleInvitation`:

```typescript
    async handleDeletedInvitation(deleted: DeletedHomebaseFile): Promise<void> {
        const uniqueId = deleted.fileMetadata.appData.uniqueId;
        if (!uniqueId) return;

        await deleteSearchIndexEntry(uniqueId);
        await deleteDocumentUpdates(uniqueId);
        await deleteSyncRecord(uniqueId);
    }
```

- [ ] **Step 5: Update pullChanges return type**

The function currently returns `{ folders: number; notes: number }`. Update the signature and return to include invitations:

```typescript
    async pullChanges(onProgress?: (progress: SyncProgress) => void): Promise<{ folders: number; notes: number; invitations: number }> {
```

Add `let invitationCount = 0;` at the top, increment it inside the invitations loop, and update the return:

```typescript
        return { folders: folderCount, notes: noteCount, invitations: invitationCount };
```

Update the `SyncResult` type in the same file or in `types/index.ts` to include `invitations` in `pulled`:

```typescript
// In SyncService.ts, update the SyncResult interface:
pulled: { folders: number; notes: number; invitations: number },
```

And initialize it in `sync()`:

```typescript
pulled: { folders: 0, notes: 0, invitations: 0 },
```

- [ ] **Step 6: Verify TypeScript and lint**

Run: `npx tsc --noEmit && npx eslint src/lib/homebase/SyncService.ts src/lib/homebase/InboxProcessor.ts`
Expected: No errors

---

### Task 5: WebSocket — Handle Invitation Notifications

**Files:**
- Modify: `src/hooks/useJournalWebsocket.ts`

- [ ] **Step 1: Add import for invitation file type**

Update the config import:

```typescript
import {
    JOURNAL_DRIVE,
    JOURNAL_FILE_TYPE,
    FOLDER_FILE_TYPE,
    COLLABORATION_INVITE_FILE_TYPE,
} from '@/lib/homebase';
```

- [ ] **Step 2: Handle invitation notifications in processNotification**

In the `processNotification` callback, inside the `fileAdded`/`fileModified`/`statisticsChanged` branch, add a case for invitations after the folder case:

```typescript
                } else if (fileType === COLLABORATION_INVITE_FILE_TYPE) {
                    await syncService.handleInvitation(notification.header);
                    queryClient.invalidateQueries({ queryKey: notesQueryKey });
                }
```

In the `fileDeleted` branch, add after the folder deletion case:

```typescript
                } else if (fileType === COLLABORATION_INVITE_FILE_TYPE) {
                    await syncService.handleDeletedInvitation(
                        notification.header as unknown as DeletedHomebaseFile,
                    );
                    queryClient.invalidateQueries({ queryKey: notesQueryKey });
                }
```

- [ ] **Step 3: Add toast notification for new invitations**

Add `toast` import at the top:

```typescript
import { toast } from 'sonner';
```

In the invitation `fileAdded` handling (inside the `COLLABORATION_INVITE_FILE_TYPE` case for fileAdded), add a toast after `handleInvitation`:

```typescript
                } else if (fileType === COLLABORATION_INVITE_FILE_TYPE) {
                    await syncService.handleInvitation(notification.header);
                    queryClient.invalidateQueries({ queryKey: notesQueryKey });
                    const content = notification.header?.fileMetadata?.appData?.content;
                    if (content) {
                        try {
                            const invite = typeof content === 'string' ? JSON.parse(content) : content;
                            if (invite.authorOdinId && invite.noteTitle) {
                                toast(`${invite.authorOdinId.split('.')[0]} shared "${invite.noteTitle}" with you`);
                            }
                        } catch { /* ignore parse errors for toast */ }
                    }
                }
```

- [ ] **Step 4: Verify TypeScript and lint**

Run: `npx tsc --noEmit && npx eslint src/hooks/useJournalWebsocket.ts`
Expected: No errors

---

### Task 6: Test — Invitation Storage

**Files:**
- Modify: `src/__tests__/database.test.ts`

- [ ] **Step 1: Add test for invitation storage and retrieval**

Add inside the `Database Operations` describe block, after the `getCollaborativeNotesForList` describe:

```typescript
    describe('Collaboration Invitation Storage', () => {
        it('should store invitation as collaborative note in search_index', async () => {
            const metadata = {
                title: 'Shared Meeting Notes',
                folderId: 'fc360190-4e23-b870-0ea4-ef233aad98ad',
                tags: [] as string[],
                timestamps: { created: '2026-04-21T10:00:00Z', modified: '2026-04-21T10:00:00Z' },
                excludeFromAI: true,
                isCollaborative: true,
                authorOdinId: 'alice.dotyou.cloud',
            };

            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata)
                 VALUES ($1, $2, $3, $4)`,
                ['invite-note-1', 'Shared Meeting Notes', 'Agenda items...', JSON.stringify(metadata)]
            );

            const result = await db.query<{
                doc_id: string;
                metadata: DocumentMetadata;
            }>(
                `SELECT doc_id, metadata FROM search_index
                 WHERE (metadata->>'isCollaborative')::boolean = true
                   AND metadata->>'authorOdinId' IS NOT NULL`
            );

            expect(result.rows).toHaveLength(1);
            expect(result.rows[0].metadata.authorOdinId).toBe('alice.dotyou.cloud');
            expect(result.rows[0].metadata.isCollaborative).toBe(true);
        });

        it('should remove invitation when deleted', async () => {
            const metadata = {
                title: 'Temp Note',
                folderId: 'fc360190-4e23-b870-0ea4-ef233aad98ad',
                tags: [] as string[],
                timestamps: { created: '2026-04-21T10:00:00Z', modified: '2026-04-21T10:00:00Z' },
                excludeFromAI: true,
                isCollaborative: true,
                authorOdinId: 'bob.dotyou.cloud',
            };

            await db.query(
                `INSERT INTO search_index (doc_id, title, plain_text_content, metadata)
                 VALUES ($1, $2, $3, $4)`,
                ['invite-note-2', 'Temp Note', 'temp', JSON.stringify(metadata)]
            );

            await db.query('DELETE FROM search_index WHERE doc_id = $1', ['invite-note-2']);

            const result = await db.query(
                'SELECT doc_id FROM search_index WHERE doc_id = $1',
                ['invite-note-2']
            );
            expect(result.rows).toHaveLength(0);
        });
    });
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/__tests__/database.test.ts`
Expected: All tests pass

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

---

### Task 7: Peer WebSocket — Extend useWebsocketSubscriber

**Files:**
- Modify: `src/hooks/useWebsocketSubscriber.ts`

- [ ] **Step 1: Add peer imports**

Update imports at the top of `src/hooks/useWebsocketSubscriber.ts`:

```typescript
import {
    ApiType,
    Unsubscribe,
    Subscribe,
    Notify,
    DotYouClient,
} from '@homebase-id/js-lib/core';
import type {
    NotificationType,
    TargetDrive,
    TypedConnectionNotification,
} from '@homebase-id/js-lib/core';
import {
    SubscribeOverPeer,
    UnsubscribeOverPeer,
    NotifyOverPeer,
} from '@homebase-id/js-lib/peer';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useDotYouClientContext } from '@/components/auth';
```

- [ ] **Step 2: Add odinId parameter and isPeer logic**

Update the function signature to add `odinId` as the second parameter:

```typescript
export const useWebsocketSubscriber = (
    handler:
        | ((dotYouClient: DotYouClient, notification: TypedConnectionNotification) => void)
        | undefined,
    odinId: string | undefined,
    types: NotificationType[],
    drives: TargetDrive[],
    onDisconnect?: () => void,
    onReconnect?: () => void,
    refId?: string
) => {
    const dotYouClient = useDotYouClientContext();
    const isPeer = useMemo(() => !!odinId && odinId !== dotYouClient.getHostIdentity(), [odinId, dotYouClient]);
```

- [ ] **Step 3: Update wrappedHandler to use peer Notify**

Replace the `Notify` call inside `wrappedHandler` with a peer-aware version:

```typescript
    const wrappedHandler = useCallback(
        (dotYouClient: DotYouClient, notification: TypedConnectionNotification) => {
            if (notification.notificationType === 'inboxItemReceived') {
                console.debug(
                    '[WebsocketSubscriber] Replying to inboxItemReceived by sending processInbox'
                );

                const notifyFn = isPeer ? NotifyOverPeer : Notify;
                notifyFn({
                    command: 'processInbox',
                    data: JSON.stringify({
                        targetDrive: notification.targetDrive,
                        batchSize: 100,
                    }),
                });
            }

            if (types?.length >= 1 && !types.includes(notification.notificationType)) return;
            handler?.(dotYouClient, notification);
        },
        [handler, types, isPeer]
    );
```

- [ ] **Step 4: Update Subscribe/Unsubscribe to use peer variants**

Replace the `Subscribe` call in the main effect with a peer-aware branch:

```typescript
    useEffect(() => {
        if (
            (dotYouClient.getType() !== ApiType.Owner && dotYouClient.getType() !== ApiType.App) ||
            !dotYouClient.getSharedSecret() ||
            !localHandler
        )
            return;

        if (connectedHandler.current) {
            if (isPeer) UnsubscribeOverPeer(connectedHandler.current);
            else Unsubscribe(connectedHandler.current);
        }

        connectedHandler.current = localHandler;
        let cancelled = false;

        const subscribeFn = isPeer
            ? () => SubscribeOverPeer(
                dotYouClient,
                odinId!,
                drives,
                localHandler,
                () => {
                    if (!cancelled) setIsConnected(false);
                    onDisconnectRef.current?.();
                },
                () => {
                    if (!cancelled) setIsConnected(true);
                    onReconnectRef.current?.();
                },
                undefined,
                refId
            )
            : () => Subscribe(
                dotYouClient,
                drives,
                localHandler,
                () => {
                    if (!cancelled) setIsConnected(false);
                    onDisconnectRef.current?.();
                },
                () => {
                    if (!cancelled) setIsConnected(true);
                    onReconnectRef.current?.();
                },
                refId
            );

        subscribeFn().then(() => {
            if (!cancelled) setIsConnected(true);
        }).catch((error: unknown) => {
            console.error('[WebsocketSubscriber] Subscribe failed:', error);
            if (!cancelled) setIsConnected(false);
            onDisconnectRef.current?.();
        });

        return () => {
            cancelled = true;
            setIsConnected(false);
            if (connectedHandler.current) {
                try {
                    if (isPeer) UnsubscribeOverPeer(connectedHandler.current);
                    else Unsubscribe(connectedHandler.current);
                } catch (e) {
                    console.error('[WebsocketSubscriber] Unsubscribe error:', e);
                }
            }
        };
    }, [localHandler, dotYouClient, drives, refId, isPeer, odinId]);
```

- [ ] **Step 5: Update existing callers to pass undefined for odinId**

In `src/hooks/useJournalWebsocket.ts`, update the `useWebsocketSubscriber` call at the bottom to pass `undefined` as the second argument:

```typescript
    return useWebsocketSubscriber(
        isEnabled ? handleNotification : undefined,
        undefined, // odinId — local subscription
        WS_NOTIFICATION_TYPES,
        WS_DRIVES,
        handleDisconnect,
        handleReconnect,
        'useJournalWebsocket'
    );
```

- [ ] **Step 6: Verify TypeScript and lint**

Run: `npx tsc --noEmit && npx eslint src/hooks/useWebsocketSubscriber.ts src/hooks/useJournalWebsocket.ts`
Expected: No errors

---

### Task 8: Peer WebSocket — usePeerNoteWebsocket Hook

**Files:**
- Create: `src/hooks/usePeerNoteWebsocket.ts`

- [ ] **Step 1: Create the hook**

Create `src/hooks/usePeerNoteWebsocket.ts`:

```typescript
import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DotYouClient, TypedConnectionNotification } from '@homebase-id/js-lib/core';
import { drivesEqual } from '@homebase-id/js-lib/helpers';
import { useWebsocketSubscriber } from './useWebsocketSubscriber';
import { notesQueryKey } from './useNotes';
import { JOURNAL_DRIVE, JOURNAL_FILE_TYPE } from '@/lib/homebase';
import type { NotificationType, TargetDrive } from '@homebase-id/js-lib/core';
import type { SyncService } from '@/lib/homebase/SyncService';

const PEER_WS_TYPES: NotificationType[] = ['fileAdded', 'fileModified'];
const PEER_WS_DRIVES: TargetDrive[] = [JOURNAL_DRIVE];

interface UsePeerNoteWebsocketOptions {
    authorOdinId: string | undefined;
    noteUniqueId: string | undefined;
    isEnabled: boolean;
    syncService: SyncService | null;
}

export const usePeerNoteWebsocket = ({
    authorOdinId,
    noteUniqueId,
    isEnabled,
    syncService,
}: UsePeerNoteWebsocketOptions) => {
    const queryClient = useQueryClient();
    const disconnectTimeRef = useRef<number | null>(null);

    const handleNotification = useCallback(
        async (_dotYouClient: DotYouClient, notification: TypedConnectionNotification) => {
            if (!syncService || !noteUniqueId) return;

            const fileUniqueId = notification.header?.fileMetadata?.appData?.uniqueId;
            if (fileUniqueId !== noteUniqueId) return;

            if (
                (notification.notificationType === 'fileAdded' ||
                    notification.notificationType === 'fileModified') &&
                drivesEqual(notification.targetDrive, JOURNAL_DRIVE) &&
                notification.header?.fileMetadata?.appData?.fileType === JOURNAL_FILE_TYPE
            ) {
                await syncService.handleRemoteNote(notification.header);
                queryClient.invalidateQueries({ queryKey: notesQueryKey });
            }
        },
        [syncService, noteUniqueId, queryClient]
    );

    const handleDisconnect = useCallback(() => {
        disconnectTimeRef.current = Date.now();
    }, []);

    const handleReconnect = useCallback(async () => {
        if (!syncService || !noteUniqueId || !authorOdinId) return;
        disconnectTimeRef.current = null;
        try {
            const freshFile = await syncService.getNoteProvider().getNote(noteUniqueId, authorOdinId, { decrypt: false });
            if (freshFile) {
                await syncService.handleRemoteNote(freshFile);
                queryClient.invalidateQueries({ queryKey: notesQueryKey });
            }
        } catch (error) {
            console.error('[PeerNoteWebsocket] Reconnect sync failed:', error);
        }
    }, [syncService, noteUniqueId, authorOdinId, queryClient]);

    const shouldSubscribe = isEnabled && !!authorOdinId && !!noteUniqueId;

    return useWebsocketSubscriber(
        shouldSubscribe ? handleNotification : undefined,
        authorOdinId,
        PEER_WS_TYPES,
        PEER_WS_DRIVES,
        handleDisconnect,
        handleReconnect,
        `peer-note-${noteUniqueId}`
    );
};
```

- [ ] **Step 2: Expose getNoteProvider on SyncService**

In `src/lib/homebase/SyncService.ts`, add a public getter for the notes provider so the peer websocket hook can call `getNote`:

```typescript
    getNoteProvider(): NotesDriveProvider {
        return this.#notesProvider;
    }
```

Add this as a method on the `SyncService` class, before the `sync()` method.

- [ ] **Step 3: Verify TypeScript and lint**

Run: `npx tsc --noEmit && npx eslint src/hooks/usePeerNoteWebsocket.ts src/lib/homebase/SyncService.ts`
Expected: No errors

---

### Task 9: Wire Peer WebSocket into EditorPage

**Files:**
- Modify: `src/pages/EditorPage.tsx`

- [ ] **Step 1: Add peer websocket to EditorPage**

In `src/pages/EditorPage.tsx`, add import:

```typescript
import { usePeerNoteWebsocket } from '@/hooks/usePeerNoteWebsocket';
import { useSyncContext } from '@/hooks/useSyncService';
```

In the `EditorPage` component (the outer one that renders `EditorProvider`), before the return, add:

```typescript
  const isPeerNote = !!selectedNoteMetadata?.authorOdinId &&
      selectedNoteMetadata.authorOdinId !== window.location.hostname;
  const { syncServiceRef } = useSyncContext();

  usePeerNoteWebsocket({
      authorOdinId: selectedNoteMetadata?.authorOdinId,
      noteUniqueId: noteId,
      isEnabled: isPeerNote,
      syncService: syncServiceRef?.current || null,
  });
```

Note: Check what `useSyncService` or `useSyncContext` exports — we need access to the `SyncService` instance. If it's exposed as `syncServiceRef`, use that. If not, we may need to expose it from the sync context.

- [ ] **Step 2: Verify the sync context exposes syncService**

Check `src/hooks/useSyncService.ts` for how `SyncService` is exposed. If it's not directly accessible, add a `syncService` field to the context return.

- [ ] **Step 3: Verify TypeScript and lint**

Run: `npx tsc --noEmit && npx eslint src/pages/EditorPage.tsx`
Expected: No errors

---

### Task 10: Final Verification

- [ ] **Step 1: Run full lint + type check + tests**

Run: `npx tsc --noEmit && npx eslint src/ && npx vitest run`
Expected: 0 errors, all tests pass

- [ ] **Step 2: Verify invitation flow manually**

Run: `npm run dev`

Test these scenarios:
1. Mark a note collaborative → check Network tab for the uploadFile call (invitation with fileType 615, allowDistribution: true)
2. Revoke collaboration → check Network tab for deleteFile call (invitation removed)
3. Verify sidebar "Shared with me" still works with locally-created collaborative notes
4. Check that existing tests still pass with the InboxProcessor changes (new `invitations` bucket)
