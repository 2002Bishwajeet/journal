/** The bridge action importer (#1138), over the real PGlite schema. */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { getActiveNoteByTitle, getSearchIndexEntry, upsertSearchIndex } from '@/lib/db/queries';
import { todayTitle } from '@/hooks/useDailyNote';
import { importBridgeActions } from '@/lib/native/bridgeImport';
import type { BridgeAction, BridgeLicense } from '@/lib/native/bridge';

const TRIAL: BridgeLicense = { state: 'trial', trialEndsAt: '2099-01-01T00:00:00.000Z' };
const OPEN_ME = '40000000-0000-0000-0000-000000000001';

let n = 0;
function action(type: BridgeAction['type'], extra: Partial<BridgeAction> = {}): BridgeAction {
    n += 1;
    return { id: `action-${n}`, type, createdAt: new Date(Date.UTC(2026, 5, 10, 12, 0, n)).toISOString(), source: 'widget', ...extra };
}

let db: PGlite;
const titles = async () =>
    (await db.query<{ title: string }>('SELECT title FROM search_index ORDER BY title')).rows.map((r) => r.title);

beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => {
    await closeTestDatabase();
});
beforeEach(async () => {
    await resetTestDatabase();
});

describe('importBridgeActions', () => {
    it('makes a new note from the text: first line title, the rest body', async () => {
        const a = action('new_note', { text: 'Shopping\nmilk\neggs' });
        const result = await importBridgeActions([a], TRIAL);
        expect(result).toEqual({ ack: [a.id], open: null });
        const created = await getActiveNoteByTitle('Shopping');
        expect(created).not.toBeNull();
        expect((await getSearchIndexEntry(created!.docId))?.plainTextContent).toContain('milk');
    });

    it('opens a blank note made without text', async () => {
        const a = action('new_note');
        const { ack, open } = await importBridgeActions([a], TRIAL);
        expect(ack).toEqual([a.id]);
        expect(open).not.toBeNull();
        expect((await getSearchIndexEntry(open!.docId))?.title).toBe('Untitled');
    });

    it("appends to today's daily note, making it once", async () => {
        const first = action('append_today', { text: 'Ran 5k' });
        const second = action('append_today', { text: 'Read a chapter' });
        const { ack } = await importBridgeActions([second, first], TRIAL);
        expect(ack).toEqual([first.id, second.id]);
        const today = await getActiveNoteByTitle(todayTitle());
        expect(today).not.toBeNull();
        const text = (await getSearchIndexEntry(today!.docId))?.plainTextContent ?? '';
        expect(text.indexOf('Ran 5k')).toBeGreaterThan(-1);
        expect(text.indexOf('Read a chapter')).toBeGreaterThan(text.indexOf('Ran 5k'));
        expect((await titles()).filter((t) => t === todayTitle())).toHaveLength(1);
    });

    it('opens the note an open action names, and acks one for a missing note', async () => {
        const now = new Date().toISOString();
        await upsertSearchIndex({
            docId: OPEN_ME,
            title: 'Plans',
            plainTextContent: 'plans',
            metadata: { title: 'Plans', folderId: 'folder-1', timestamps: { created: now, modified: now }, excludeFromAI: false },
        });
        const open = action('open', { noteId: OPEN_ME });
        const missing = action('open', { noteId: '40000000-0000-0000-0000-000000000099' });
        const malformed = action('open', { noteId: 'nope' });
        expect(await importBridgeActions([open], TRIAL)).toEqual({ ack: [open.id], open: { docId: OPEN_ME, folderId: 'folder-1' } });
        expect(await importBridgeActions([missing, malformed], TRIAL)).toEqual({ ack: [missing.id, malformed.id], open: null });
    });

    it('imports an action once when the app stopped between saving and acking', async () => {
        const a = action('new_note', { text: 'Only once' });
        expect((await importBridgeActions([a], TRIAL)).ack).toEqual([a.id]);
        // The ack never reached the native queue, so the same file comes back.
        expect((await importBridgeActions([a], TRIAL)).ack).toEqual([a.id]);
        expect((await titles()).filter((t) => t === 'Only once')).toHaveLength(1);
    });

    it.each<BridgeLicense>([{ state: 'expired' }, { state: 'none' }])('rejects every action with a $state licence', async (license) => {
        const actions = [action('new_note', { text: 'Blocked' }), action('append_today', { text: 'Blocked too' })];
        expect(await importBridgeActions(actions, license)).toEqual({ ack: [], open: null });
        expect(await titles()).toEqual([]);
    });

    it('imports with a paid licence', async () => {
        const a = action('new_note', { text: 'Paid' });
        expect((await importBridgeActions([a], { state: 'licensed' })).ack).toEqual([a.id]);
    });
});
