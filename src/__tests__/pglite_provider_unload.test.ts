import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import * as Y from 'yjs';

// #873: iOS Safari unloads the page before the write of the last edits finishes.
// Real DB, mocked at the pglite singleton boundary (see pglite_provider.test.ts).
vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';

// `unloaded` stands in for a page that went away: its writes never finish.
const saveControl = { unloaded: false };
vi.mock('@/lib/db', async (importActual) => {
    const actual = await importActual<typeof import('@/lib/db')>();
    return {
        ...actual,
        saveDocumentUpdate: (docId: string, blob: Uint8Array) =>
            saveControl.unloaded ? new Promise<void>(() => {}) : actual.saveDocumentUpdate(docId, blob),
    };
});
import { getDocumentUpdates } from '@/lib/db';
import { PGliteProvider } from '@/lib/yjs/provider';
import { discardAllUnsavedEdits } from '@/lib/yjs/unsavedEdits';

const DOC_ID = '22222222-2222-2222-2222-222222222222';
const KEY = `journal-unsaved-edits:${DOC_ID}`;

let db: PGlite;
let storage: Map<string, string>;
let page: { window: EventTarget; document: EventTarget & { visibilityState: string } };

beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => {
    await resetTestDatabase();
    saveControl.unloaded = false;
    storage = new Map();
    vi.stubGlobal('localStorage', {
        get length() { return storage.size; },
        key: (i: number) => [...storage.keys()][i] ?? null,
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
        removeItem: (k: string) => void storage.delete(k),
    });
    newPage();
});
afterEach(() => { vi.unstubAllGlobals(); });

/** A fresh window and document, as after a reload. */
function newPage() {
    page = { window: new EventTarget(), document: Object.assign(new EventTarget(), { visibilityState: 'visible' }) };
    vi.stubGlobal('window', page.window);
    vi.stubGlobal('document', page.document);
}

async function openNote() {
    const doc = new Y.Doc();
    const provider = new PGliteProvider(DOC_ID, doc);
    await provider.load();
    return { doc, provider, text: () => doc.getText('body').toString() };
}

async function storedText(): Promise<string> {
    const d = new Y.Doc();
    for (const u of await getDocumentUpdates(DOC_ID)) Y.applyUpdate(d, u);
    return d.getText('body').toString();
}

describe('PGliteProvider unload copy (#873)', () => {
    it('keeps a line typed just before pagehide when its database write never finishes', async () => {
        const before = await openNote();
        before.doc.getText('body').insert(0, 'last line');
        saveControl.unloaded = true;
        page.window.dispatchEvent(new Event('pagehide'));
        expect(storage.has(KEY)).toBe(true);
        expect(await getDocumentUpdates(DOC_ID)).toHaveLength(0);

        // The reloaded page
        saveControl.unloaded = false;
        newPage();
        const after = await openNote();
        expect(after.text()).toBe('last line');
        await after.provider.flush();
        expect(await storedText()).toBe('last line');
    });

    it('copies the edits when the page is hidden, not when it shows again', async () => {
        const note = await openNote();
        note.doc.getText('body').insert(0, 'hidden');
        page.document.dispatchEvent(new Event('visibilitychange'));
        expect(storage.has(KEY)).toBe(false);

        saveControl.unloaded = true;
        page.document.visibilityState = 'hidden';
        page.document.dispatchEvent(new Event('visibilitychange'));
        saveControl.unloaded = false;
        newPage();
        expect((await openNote()).text()).toBe('hidden');
    });

    it('keeps the copy through a second quick reload, and removes it when the note closes', async () => {
        const first = await openNote();
        first.doc.getText('body').insert(0, 'twice');
        saveControl.unloaded = true;
        page.window.dispatchEvent(new Event('pagehide'));

        // Reloaded, but unloaded again before the restored line was written
        newPage();
        const second = await openNote();
        expect(second.text()).toBe('twice');
        page.window.dispatchEvent(new Event('pagehide'));

        saveControl.unloaded = false;
        newPage();
        const third = await openNote();
        expect(third.text()).toBe('twice');
        await third.provider.destroy();
        expect(await storedText()).toBe('twice');
        expect(storage.has(KEY)).toBe(false);
    });

    it('writes no copy for a note opened and hidden without edits', async () => {
        await openNote();
        page.window.dispatchEvent(new Event('pagehide'));
        expect(storage.size).toBe(0);
    });

    // Last: the discard lasts for the rest of the page (the module's lifetime).
    it('deletes every copy on logout and writes none afterwards', async () => {
        const note = await openNote();
        note.doc.getText('body').insert(0, 'private');
        page.window.dispatchEvent(new Event('pagehide'));
        storage.set('journal-open-tabs', '[]');

        discardAllUnsavedEdits();
        expect([...storage.keys()]).toEqual(['journal-open-tabs']);
        note.doc.getText('body').insert(0, 'more ');
        page.window.dispatchEvent(new Event('pagehide'));
        expect([...storage.keys()]).toEqual(['journal-open-tabs']);
    });
});
