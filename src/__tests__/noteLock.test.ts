/**
 * Locked notes and folders (#1427) over the real PGlite schema: what a lock hides (the list
 * preview, body search, the agent tools), how a folder's lock reaches its notes, what refuses
 * a lock, and when unlocked notes lock again. Touch ID is the key command, faked at its invoke.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

const { invoke } = vi.hoisted(() => ({
    invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import {
    advancedSearch,
    createFolder,
    getFolderById,
    getNotesForList,
    getNotesForListByFolder,
    getSearchIndexEntry,
    getSyncRecord,
    saveDocumentUpdate,
    searchNotesForPicker,
    setFolderPublicLocal,
    updateSearchIndexMetadata,
    upsertSearchIndex,
} from '@/lib/db/queries';
import { isNoteOpen, relockNotes, setFolderLocked, setNoteLocked, unlockFolder, unlockNote } from '@/lib/noteLock';
import { lockApp } from '@/lib/appLock';
import { createLocalDeps } from '@/lib/agent/local/localDeps';
import { TOOLS } from '@/lib/agent/tools/registry';
import { appendMarkdown } from '@/lib/agent/editEngine';
import { resolveAccess } from '@/lib/agent/grants';
import { noteFileContent } from '@/lib/homebase/noteUploadMetadata';
import { computeContentHash } from '@/lib/utils/hash';
import type { DocumentMetadata, NoteListEntry } from '@/types';

const MAIN = '14270000-0000-0000-0000-000000000000';
const VAULT = '14270000-0000-0000-0000-000000000001';
const OPEN = '14270000-0000-0000-0000-0000000000a1';
const SECRET = '14270000-0000-0000-0000-0000000000a2';
const IN_VAULT = '14270000-0000-0000-0000-0000000000a3';

async function addNote(docId: string, title: string, body: string, folderId: string, extra: Partial<DocumentMetadata> = {}) {
    const now = new Date().toISOString();
    await upsertSearchIndex({
        docId,
        title,
        plainTextContent: body,
        metadata: { title, folderId, timestamps: { created: now, modified: now }, excludeFromAI: false, ...extra },
    });
    const doc = new Y.Doc();
    appendMarkdown(doc, body);
    await saveDocumentUpdate(docId, Y.encodeStateAsUpdate(doc));
}

const byId = (notes: NoteListEntry[], id: string) => notes.find((n) => n.docId === id)!;

const run = (name: string, input: object) => {
    const tool = TOOLS.find((t) => t.name === name)!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tools' results are typed per tool
    return tool.execute(createLocalDeps() as Parameters<typeof tool.execute>[0], tool.input.parse(input)) as Promise<{ data: any }>;
};

/** Touch ID answers `answer` to every check. */
const touchId = (answer: 'cancelled' | 'failed' | null) =>
    invoke.mockImplementation(async (cmd) => (cmd === 'plugin:journal-db-key|confirm_owner' ? answer : null));

const moveTo = async (docId: string, folderId: string) => {
    const entry = (await getSearchIndexEntry(docId))!;
    await updateSearchIndexMetadata(docId, entry.title, { ...entry.metadata, folderId });
};

beforeAll(async () => {
    setTestDb(await createTestDatabase());
});
afterAll(async () => {
    await closeTestDatabase();
});
beforeEach(async () => {
    await resetTestDatabase();
    relockNotes();
    invoke.mockReset();
    touchId(null);
    await createFolder(MAIN, 'Notes');
    await createFolder(VAULT, 'Vault');
    await addNote(OPEN, 'Groceries', 'Buy zucchini and lemons.', MAIN);
    await addNote(SECRET, 'Diary', 'The zucchini plan is a secret.', MAIN, { locked: true });
    await addNote(IN_VAULT, 'Passwords', 'Router zucchini code.', VAULT);
});

describe('the lock syncs', () => {
    it('is in the note file the push uploads, and changes its hash so the push runs', async () => {
        const metadata = (await getSearchIndexEntry(OPEN))!.metadata;
        expect(noteFileContent({ ...metadata, locked: true }).locked).toBe(true);
        expect(await computeContentHash({ ...metadata, locked: true })).not.toBe(await computeContentHash(metadata));
        // A note never locked hashes as before.
        expect(await computeContentHash({ ...metadata, locked: false })).toBe(await computeContentHash(metadata));
    });
});

describe('a locked note in the note list', () => {
    it('keeps its title and loses its preview', async () => {
        const notes = await getNotesForList();
        expect(byId(notes, SECRET)).toMatchObject({ title: 'Diary', preview: '', locked: true });
        expect(byId(notes, OPEN)).toMatchObject({ preview: 'Buy zucchini and lemons.', locked: false });
    });

    it('a locked folder locks every note in it, and a note moved out keeps only its own lock', async () => {
        expect(await setFolderLocked(VAULT, true)).toBe('done');
        expect(byId(await getNotesForListByFolder(VAULT), IN_VAULT)).toMatchObject({ preview: '', locked: true });
        // The folder's lock syncs: its record is pending.
        expect((await getSyncRecord(VAULT))?.syncStatus).toBe('pending');
        expect((await getFolderById(VAULT))?.locked).toBe(true);

        // Moved into the locked folder: locked. Moved out: as it was before.
        await moveTo(OPEN, VAULT);
        expect(byId(await getNotesForListByFolder(VAULT), OPEN).locked).toBe(true);
        await moveTo(OPEN, MAIN);
        expect(byId(await getNotesForList(), OPEN).locked).toBe(false);
        await moveTo(SECRET, VAULT);
        await moveTo(SECRET, MAIN);
        expect(byId(await getNotesForList(), SECRET).locked).toBe(true);
    });

    it('a write from a stale snapshot never drops the lock; only Remove lock does', async () => {
        const stale = (await getSearchIndexEntry(OPEN))!.metadata;
        expect(await setNoteLocked(OPEN, true)).toBe('done');
        await updateSearchIndexMetadata(OPEN, 'Groceries!', { ...stale, title: 'Groceries!' });
        expect((await getSearchIndexEntry(OPEN))?.metadata.locked).toBe(true);
        expect(await setNoteLocked(OPEN, false)).toBe('done');
        expect((await getSearchIndexEntry(OPEN))?.metadata.locked).toBe(false);
    });
});

describe('search', () => {
    it('finds a locked note by its title only, never by its body', async () => {
        const ids = async (q: string) => (await advancedSearch(q)).map((r) => r.docId);
        expect((await ids('zucchini')).sort()).toEqual([OPEN, IN_VAULT].sort());
        expect(await ids('secret')).toEqual([]);
        const hit = (await advancedSearch('Diary')).find((r) => r.docId === SECRET);
        expect(hit?.contentHighlight).toBeUndefined();

        await setFolderLocked(VAULT, true);
        expect(await ids('router')).toEqual([]);
        expect(await ids('Passwords')).toEqual([IN_VAULT]);
    });

    it('the note-link picker matches a locked note by its title, not its body', async () => {
        expect((await searchNotesForPicker('secret')).map((n) => n.docId)).toEqual([]);
        expect((await searchNotesForPicker('Diary')).map((n) => n.docId)).toEqual([SECRET]);
    });
});

describe('the agent tools', () => {
    it('never list, read or find a locked note, nor one in a locked folder', async () => {
        await setFolderLocked(VAULT, true);
        const listed = (await run('list_notes', {})).data.map((n: { id: string }) => n.id);
        expect(listed).toEqual([OPEN]);
        await expect(run('get_note', { id: SECRET })).rejects.toThrow('Note not found');
        await expect(run('get_note', { id: IN_VAULT })).rejects.toThrow('Note not found');
        const found = (await run('search_notes', { query: 'zucchini' })).data.map((n: { id: string }) => n.id);
        expect(found).toEqual([OPEN]);
        expect(resolveAccess({ version: 1, folders: { [MAIN]: 'write' }, notes: { [SECRET]: 'write' } }, { noteId: SECRET, folderId: MAIN, locked: true })).toBe('none');
    });
});

describe('locking and removing a lock', () => {
    it('refuses to lock a shared note, a shared folder, or a folder with a shared note in it', async () => {
        const PUBLIC = '14270000-0000-0000-0000-0000000000b1';
        await addNote(PUBLIC, 'Recipe', 'Public zucchini bread.', VAULT, { isPublic: true });
        expect(await setNoteLocked(PUBLIC, true)).toBe('shared');
        expect((await getSearchIndexEntry(PUBLIC))?.metadata.locked).toBeUndefined();
        expect(await setFolderLocked(VAULT, true)).toBe('shared');

        const SHARED_FOLDER = '14270000-0000-0000-0000-000000000002';
        await createFolder(SHARED_FOLDER, 'Blog');
        await setFolderPublicLocal(SHARED_FOLDER, true);
        expect(await setFolderLocked(SHARED_FOLDER, true)).toBe('shared');
        expect((await getFolderById(SHARED_FOLDER))?.locked).toBe(false);
    });

    it('locking needs no check; removing a lock asks every time and keeps a refusal from nothing', async () => {
        expect(await setNoteLocked(OPEN, true)).toBe('done');
        expect(invoke).not.toHaveBeenCalled();

        touchId('cancelled');
        expect(await setNoteLocked(OPEN, false)).toBe('cancelled');
        expect((await getSearchIndexEntry(OPEN))?.metadata.locked).toBe(true);
        touchId(null);
        expect(await setNoteLocked(OPEN, false)).toBe('done');
        expect(invoke).toHaveBeenCalledTimes(2);
        expect(invoke).toHaveBeenCalledWith('plugin:journal-db-key|confirm_owner');
    });
});

describe('unlocking and locking again', () => {
    const secret = { docId: SECRET, metadata: { folderId: MAIN, locked: true } };
    const inVault = { docId: IN_VAULT, metadata: { folderId: VAULT } };

    it('a refused check opens nothing, and the next Unlock asks again', async () => {
        touchId('failed');
        expect(await unlockNote(secret, false)).toBe('failed');
        expect(isNoteOpen(secret, false)).toBe(false);
        touchId(null);
        expect(await unlockNote(secret, false)).toBe('done');
        expect(isNoteOpen(secret, false)).toBe(true);
        expect(invoke).toHaveBeenCalledTimes(2);
    });

    it('one Unlock of a locked folder opens all its notes', async () => {
        const other = { docId: '14270000-0000-0000-0000-0000000000c1', metadata: { folderId: VAULT, locked: true } };
        expect(isNoteOpen(inVault, true)).toBe(false);
        expect(await unlockFolder(VAULT)).toBe('done');
        expect(isNoteOpen(inVault, true)).toBe(true);
        expect(isNoteOpen(other, true)).toBe(true);
        // Unlocking one note of a locked folder opens the folder.
        relockNotes();
        expect(await unlockNote(inVault, true)).toBe('done');
        expect(isNoteOpen(other, true)).toBe(true);
    });

    it('locking a note again closes it at once', async () => {
        const open = { docId: OPEN, metadata: { folderId: MAIN } };
        await unlockNote(open, false);
        expect(isNoteOpen(open, false)).toBe(true);
        await setNoteLocked(OPEN, true);
        expect(isNoteOpen(open, false)).toBe(false);
    });

    it('Lock now locks every unlocked note and folder again', async () => {
        await unlockNote(secret, false);
        await unlockFolder(VAULT);
        const reload = vi.fn();
        vi.stubGlobal('window', { location: { reload } });
        vi.stubGlobal('sessionStorage', { setItem: vi.fn() });
        try {
            await lockApp();
        } finally {
            vi.unstubAllGlobals();
        }
        expect(reload).toHaveBeenCalled();
        expect(isNoteOpen(secret, false)).toBe(false);
        expect(isNoteOpen(inVault, true)).toBe(false);
    });
});
