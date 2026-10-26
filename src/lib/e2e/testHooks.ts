/**
 * E2E-only readiness hooks. Installed exclusively from `main.tsx`'s
 * `if (import.meta.env.MODE === 'e2e')` branch via a dynamic import, so this
 * module (and its `window.__journalE2E` global) never ships in the production
 * bundle. See src/globals.d.ts for the public type.
 *
 * The hooks read signals the app already maintains (bootProgress and the boot
 * splash) or draw a link card. The exceptions: the ignoreInvites switch, which
 * lasts until the page reloads, deleteFilesNamed, which the live tier's
 * teardown uses to remove what the sharing specs leave on an identity, and
 * subscribePeerPush / journalNotifications for the share push spec (#745).
 */
import { getBootError, getBootProgress, PHASE_PROGRESS, subscribeBootProgress } from '@/lib/bootProgress';
import { e2eSwitches } from './switches';

const E2E_ORIGINS = [
    'http://127.0.0.1:4173',
    'http://127.0.0.1:5174',
    'https://e2e.dotyou.cloud:4443',
];

// Progress is monotonic, so reaching db-ready's value means db-ready has fired.
// A boot error rejects instead, so the fixture reports it rather than timing out.
function waitForDbReady(): Promise<void> {
    return new Promise((resolve, reject) => {
        const settle = () => {
            const error = getBootError();
            if (!error && getBootProgress() < PHASE_PROGRESS['db-ready']) return;
            unsubscribe();
            if (error) reject(error);
            else resolve();
        };
        const unsubscribe = subscribeBootProgress(settle);
        settle();
    });
}

// The boot splash (src/components/layout/SplashScreen.tsx) is the only
// element in the app with role="progressbar" — its removal from the DOM is
// what "the main UI mounted" means in practice, since the splash is replaced
// by the real layout rather than transitioning through some other signal.
// Past BOOT_TIMEOUT_MS it becomes the "taking too long" screen, which is no
// more the main UI than the splash was.
function isSplashGone(): boolean {
    return document.querySelector('[role="progressbar"], [data-boot-stalled]') === null;
}

function waitForSplashGone(): Promise<void> {
    if (isSplashGone()) return Promise.resolve();
    return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
            if (isSplashGone()) {
                observer.disconnect();
                resolve();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    });
}

async function ready(): Promise<void> {
    await waitForDbReady();
    await waitForSplashGone();
}

/** Draw a link card image (#434) the way publishing does; nothing is stored or uploaded. */
async function renderCard(...args: Parameters<JournalE2EHooks['renderCard']>): Promise<Blob> {
    const { renderCardImage } = await import('@/lib/share/cardImage');
    return renderCardImage(...args);
}

/** Opens an ActionSheet (#823) over the app, which no screen uses yet; it removes itself once closed. */
async function showActionSheet(): Promise<void> {
    const [{ createElement }, { createRoot }, { ActionSheet }, { Pencil, Share2, Trash2 }] = await Promise.all([
        import('react'),
        import('react-dom/client'),
        import('@/components/ui/action-sheet'),
        import('lucide-react'),
    ]);
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    const render = (open: boolean) =>
        root.render(
            createElement(ActionSheet, {
                open,
                onOpenChange: (next: boolean) => {
                    render(next);
                    if (!next) setTimeout(() => { root.unmount(); host.remove(); }, 500);
                },
                title: 'Note actions',
                items: [
                    { label: 'Rename', icon: Pencil, action: () => {} },
                    { label: 'Share', icon: Share2, action: () => {} },
                    { label: 'Delete', icon: Trash2, action: () => {}, variant: 'destructive' },
                ],
            }),
        );
    render(true);
}

/** True while an edit is still queued for, or being written to, PGlite (the document and the editor's search-index write). */
async function hasUnsavedEdits(): Promise<boolean> {
    const { PGliteProvider } = await import('@/lib/yjs/provider');
    const { hasPendingEditorWrites } = await import('@/lib/yjs/pendingEditorWrites');
    return PGliteProvider.hasUnpersistedUpdates() || hasPendingEditorWrites();
}

/** Resolves once PGlite has flushed everything it committed to IndexedDB (a commit returns before that). */
async function syncToDisk(): Promise<void> {
    const { getDatabase } = await import('@/lib/db/pglite');
    await (await getDatabase()).syncToFs();
}

/** Skip incoming invites until the page reloads, so a share arrives only through the shared pull (#732). */
function ignoreInvites(): void {
    e2eSwitches.ignoreInvites = true;
}

/**
 * Leaves exactly 6 unsynced items for Settings → Diagnostics (#800): three notes, a folder, an
 * image and a note delete. A note and the folder also carry an error; those two are in backoff, so a
 * sync pass leaves their messages alone.
 */
async function seedPendingSync(): Promise<void> {
    const { getDatabase } = await import('@/lib/db/pglite');
    const { upsertSearchIndex, upsertSyncRecord, createFolder, recordSyncError, savePendingImageUpload } =
        await import('@/lib/db');
    const { MAIN_FOLDER_ID } = await import('@/lib/homebase');
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const now = new Date().toISOString();

    // Start from an empty queue; the Main folder is unsynced on a fresh app, so mark it synced.
    await (await getDatabase()).exec('DELETE FROM sync_records; DELETE FROM sync_errors; DELETE FROM pending_image_uploads;');
    await upsertSyncRecord({ localId: MAIN_FOLDER_ID, entityType: 'folder', syncStatus: 'synced', remoteFileId: 'seeded-main-folder' });

    for (const [n, title] of [[1, 'Seeded note A'], [2, 'Seeded note B'], [3, 'Seeded note C']] as const) {
        await upsertSearchIndex({
            docId: id(n),
            title,
            plainTextContent: '',
            metadata: { title, folderId: MAIN_FOLDER_ID, timestamps: { created: now, modified: now }, excludeFromAI: false },
        });
        await upsertSyncRecord({ localId: id(n), entityType: 'note', syncStatus: 'pending' });
    }
    await createFolder(id(4), 'Seeded folder');
    await upsertSyncRecord({ localId: id(4), entityType: 'folder', syncStatus: 'pending' });
    await upsertSyncRecord({ localId: id(6), entityType: 'note', syncStatus: 'pending_delete', remoteFileId: 'seeded-remote-file' });
    await savePendingImageUpload({
        id: id(5),
        noteDocId: id(1),
        blobData: new Uint8Array([1, 2, 3]),
        contentType: 'image/png',
        status: 'pending',
        retryCount: 0,
        createdAt: now,
    });

    await recordSyncError(id(2), 'note', 'push', 'Request failed with status code 403');
    await recordSyncError(id(4), 'folder', 'push', 'Network Error');
    await (await getDatabase()).query(
        `UPDATE sync_errors SET next_retry_at = CURRENT_TIMESTAMP + INTERVAL '1 hour' WHERE resolved_at IS NULL`,
    );
}

/**
 * Leaves only image uploads in a note already on the server, as an image added on this
 * device does (#874): one per entry of `images` (PNG bytes), in a note titled `title`.
 */
async function seedImageUploads(title: string, images: number[][]): Promise<void> {
    const { getDatabase } = await import('@/lib/db/pglite');
    const { upsertSearchIndex, upsertSyncRecord, savePendingImageUpload } = await import('@/lib/db');
    const { MAIN_FOLDER_ID } = await import('@/lib/homebase');
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const now = new Date().toISOString();

    await (await getDatabase()).exec('DELETE FROM sync_records; DELETE FROM sync_errors; DELETE FROM pending_image_uploads;');
    await upsertSyncRecord({ localId: MAIN_FOLDER_ID, entityType: 'folder', syncStatus: 'synced', remoteFileId: 'seeded-main-folder' });
    await upsertSearchIndex({
        docId: id(1),
        title,
        plainTextContent: '',
        metadata: { title, folderId: MAIN_FOLDER_ID, timestamps: { created: now, modified: now }, excludeFromAI: false },
    });
    await upsertSyncRecord({ localId: id(1), entityType: 'note', syncStatus: 'synced', remoteFileId: 'seeded-remote-note', versionTag: 'seeded-version' });
    for (const [i, bytes] of images.entries()) {
        await savePendingImageUpload({
            id: id(10 + i),
            noteDocId: id(1),
            blobData: new Uint8Array(bytes),
            contentType: 'image/png',
            status: 'pending',
            retryCount: 0,
            createdAt: now,
        });
    }
}

/** Runs the sync's image upload step once, as a full sync does after its pull and push. */
async function uploadPendingImages(): Promise<void> {
    const { SyncService } = await import('@/lib/homebase/SyncService');
    await new SyncService(await appClient(), { isOnline: true }).processPendingImageUploads();
}

/** The signed-in identity's app client, built from the stored token like the app's own. */
async function appClient() {
    const { DotYouClient, ApiType } = await import('@homebase-id/js-lib/core');
    const { retrieveIdentity } = await import('@homebase-id/js-lib/auth');
    const { base64ToUint8Array } = await import('@homebase-id/js-lib/helpers');
    const { STORAGE_KEY_AUTH_TOKEN, STORAGE_KEY_SHARED_SECRET } = await import('@/lib/homebase/config');
    return new DotYouClient({
        api: ApiType.App,
        hostIdentity: retrieveIdentity()!,
        sharedSecret: base64ToUint8Array(localStorage.getItem(STORAGE_KEY_SHARED_SECRET)!),
        headers: { bx0900: localStorage.getItem(STORAGE_KEY_AUTH_TOKEN)! },
    });
}

/** Records that the identity's server refused a share push, as a 400 on a drive without subscriptions does (#848). */
async function refuseSharePush(): Promise<void> {
    const { markShareNotificationsOff } = await import('@/lib/homebase/shareNotifications');
    markShareNotificationsOff((await appClient()).getHostIdentity());
}

/** Subscribes to `odinId`'s Journal peer push now, as the app's daily pass does (#743). */
async function subscribePeerPush(odinId: string): Promise<void> {
    const { PeerPushSubscriptionProvider } = await import('@/lib/homebase/PeerPushSubscriptionProvider');
    await new PeerPushSubscriptionProvider(await appClient()).subscribe(odinId);
}

/** The newest entries of the identity's notification list for Journal (#745). */
async function journalNotifications(): Promise<{ id: string; senderId: string; unread: boolean; typeId: string; tagId: string }[]> {
    const { GetNotifications } = await import('@homebase-id/js-lib/core');
    const { JOURNAL_APP_ID } = await import('@/lib/homebase/config');
    const { results } = await GetNotifications(await appClient(), JOURNAL_APP_ID, 100, undefined);
    return results.map(({ id, senderId, unread, options }) => ({ id, senderId, unread, typeId: options.typeId, tagId: options.tagId }));
}

/**
 * Deletes the signed-in identity's folders (with their notes), notes and collaboration
 * invites whose name matches `namePattern`, straight on the server; returns the names.
 */
export async function deleteFilesNamed(namePattern: string): Promise<string[]> {
    const { queryBatch, getContentFromHeaderOrPayload, deleteFile, deleteFilesByGroupId } =
        await import('@homebase-id/js-lib/core');
    const { JOURNAL_DRIVE, JOURNAL_FILE_TYPE, FOLDER_FILE_TYPE, COLLABORATION_INVITE_FILE_TYPE } =
        await import('@/lib/homebase/config');
    const client = await appClient();
    const pattern = new RegExp(namePattern);
    const matches: { fileId: string; name: string; folderId?: string }[] = [];
    let cursorState: string | undefined;
    for (;;) {
        const page = await queryBatch(
            client,
            { targetDrive: JOURNAL_DRIVE, fileType: [JOURNAL_FILE_TYPE, FOLDER_FILE_TYPE, COLLABORATION_INVITE_FILE_TYPE] },
            { maxRecords: 100, cursorState, includeMetadataHeader: true },
        );
        for (const file of page.searchResults) {
            // A folder's content has `name`, a note's `title`, and an invite names its note in `noteTitle`.
            const content = await getContentFromHeaderOrPayload<{ name?: string; title?: string; noteTitle?: string }>(client, JOURNAL_DRIVE, file, true);
            const name = content?.name ?? content?.title ?? content?.noteTitle;
            if (!name || !pattern.test(name)) continue;
            const isFolder = file.fileMetadata.appData.fileType === FOLDER_FILE_TYPE;
            matches.push({ fileId: file.fileId, name, folderId: isFolder ? file.fileMetadata.appData.uniqueId : undefined });
        }
        if (page.searchResults.length < 100) break;
        cursorState = page.cursorState;
    }
    // Folders last: deleting one deletes its notes too.
    matches.sort((a, b) => Number(!!a.folderId) - Number(!!b.folderId));
    for (const { fileId, folderId } of matches) {
        if (folderId) await deleteFilesByGroupId(client, JOURNAL_DRIVE, [folderId]);
        await deleteFile(client, JOURNAL_DRIVE, fileId);
    }
    return matches.map(({ name }) => name);
}

if (E2E_ORIGINS.includes(location.origin)) {
    Object.defineProperty(window, '__journalE2E', {
        value: Object.freeze({ ready, renderCard, hasUnsavedEdits, showActionSheet, syncToDisk, ignoreInvites, seedPendingSync, seedImageUploads, uploadPendingImages, refuseSharePush, deleteFilesNamed, subscribePeerPush, journalNotifications }),
        writable: false,
        configurable: false,
        enumerable: false,
    });
}
