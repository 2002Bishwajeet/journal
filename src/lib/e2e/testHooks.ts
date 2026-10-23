/**
 * E2E-only readiness hooks. Installed exclusively from `main.tsx`'s
 * `if (import.meta.env.MODE === 'e2e')` branch via a dynamic import, so this
 * module (and its `window.__journalE2E` global) never ships in the production
 * bundle. See src/globals.d.ts for the public type.
 *
 * Nothing here mutates app state — the hooks only read signals the app
 * already maintains (bootProgress and the boot splash), draw a link card, or
 * send the requests of the sharing security check (#681), which the server
 * must refuse.
 */
import { ApiType, DotYouClient, type EncryptedKeyHeader, type KeyHeader } from '@homebase-id/js-lib/core';
import { retrieveIdentity } from '@homebase-id/js-lib/auth';
import { base64ToUint8Array, getRandom16ByteArray } from '@homebase-id/js-lib/helpers';
import { getBootError, getBootProgress, PHASE_PROGRESS, subscribeBootProgress } from '@/lib/bootProgress';
import { COLLABORATIVE_FOLDER_ID, STORAGE_KEY_AUTH_TOKEN, STORAGE_KEY_SHARED_SECRET } from '@/lib/homebase/config';
import { httpStatus } from '@/lib/homebase/httpStatus';

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
function isSplashGone(): boolean {
    return document.querySelector('[role="progressbar"]') === null;
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

/** The signed-in identity's app client, built as useAuth builds it. */
function appClient(): DotYouClient {
    const token = localStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
    const secret = localStorage.getItem(STORAGE_KEY_SHARED_SECRET);
    return new DotYouClient({
        api: ApiType.App,
        hostIdentity: retrieveIdentity() ?? '',
        sharedSecret: secret ? base64ToUint8Array(secret) : undefined,
        headers: token ? { bx0900: token } : {},
    });
}

/** The ids a peer update of one of this identity's notes addresses, from its server. */
async function noteHeader(docId: string): Promise<{ globalTransitId?: string; versionTag: string } | null> {
    const { NotesDriveProvider } = await import('@/lib/homebase/NotesDriveProvider');
    const header = await new NotesDriveProvider(appClient()).getNote(docId, undefined, { decrypt: false });
    return header && { globalTransitId: header.fileMetadata.globalTransitId, versionTag: header.fileMetadata.versionTag };
}

/**
 * As this identity, reads and then patches another identity's note over peer with the
 * requests a collaborator's app sends (NotesDriveProvider.getNote and updateNote), and
 * reports what each got. The read reports PeerNoteFallback's status names. A patch that
 * goes through retitles the note to "Security probe". This identity can't read the
 * note's key, so the patch is encrypted with a key of its own: a well-formed update,
 * which only the server's access checks can refuse.
 */
async function probePeerNote(
    ...[authorOdinId, docId, globalTransitId, versionTag]: Parameters<JournalE2EHooks['probePeerNote']>
): Promise<{ read: string; patch: string }> {
    const [{ NotesDriveProvider }, { classifyPeerFetchError }] = await Promise.all([
        import('@/lib/homebase/NotesDriveProvider'),
        import('@/lib/homebase/sync/peerNotes'),
    ]);
    const provider = new NotesDriveProvider(appClient());
    const refused = (err: unknown) => `refused ${httpStatus(err) ?? 'without a response'}: ${(err as Error).message}`;

    let read: string;
    try {
        read = (await provider.getNote(docId, authorOdinId, { decrypt: false })) ? 'read' : 'notfound';
    } catch (err) {
        read = `${classifyPeerFetchError(err)} (${refused(err)})`;
    }

    const now = new Date().toISOString();
    const ownKey: KeyHeader = { aesKey: getRandom16ByteArray(), iv: getRandom16ByteArray() };
    let patch: string;
    try {
        const result = await provider.updateNote(docId, '', versionTag, {
            title: 'Security probe',
            folderId: COLLABORATIVE_FOLDER_ID,
            timestamps: { created: now, modified: now },
            excludeFromAI: true,
            isCollaborative: true,
        }, authorOdinId, globalTransitId, undefined,
        // patchFile takes a plain key header too; updateNote's type only names the cached, encrypted one
        ownKey as unknown as EncryptedKeyHeader);
        patch = `accepted (versionTag ${result.versionTag})`;
    } catch (err) {
        patch = refused(err);
    }
    return { read, patch };
}

if (E2E_ORIGINS.includes(location.origin)) {
    Object.defineProperty(window, '__journalE2E', {
        value: Object.freeze({ ready, renderCard, hasUnsavedEdits, syncToDisk, noteHeader, probePeerNote }),
        writable: false,
        configurable: false,
        enumerable: false,
    });
}
