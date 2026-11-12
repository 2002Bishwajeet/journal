/** #1118: the macOS Services menu, with the premium plugin mocked, over the real PGlite schema. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { closeTestDatabase, createTestDatabase, resetTestDatabase } from './testDb';

const { invoke, listen, toast } = vi.hoisted(() => ({
    invoke: vi.fn(),
    listen: vi.fn(),
    toast: { success: vi.fn() },
}));

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('sonner', () => ({ toast }));

import { setTestDb } from './pgliteMock';
import { getActiveNoteByTitle, getSearchIndexEntry } from '@/lib/db/queries';
import { todayTitle } from '@/hooks/useDailyNote';
import {
    hasMacServices,
    importServiceCalls,
    importServiceCallsWhileMounted,
    serviceAction,
    type ServiceCall,
} from '@/lib/native/macServices';
import { sharedNote } from '@/lib/sharedNote';

const PLUGIN = 'journal-services';
const CREATED = Date.UTC(2026, 10, 12, 9, 30);

let n = 0;
const call = (kind: ServiceCall['kind'], text: string): ServiceCall => {
    n += 1;
    return { id: `services-${CREATED}-${n}`, kind, text, createdAt: CREATED + n };
};

/** The native queue: `services_take` returns what is held, `services_ack` drops it. */
function nativeQueue(held: ServiceCall[]) {
    invoke.mockImplementation(async (cmd: string, args?: { ids: string[] }) => {
        const command = cmd.replace(`plugin:${PLUGIN}|`, '');
        if (command === 'services_take') return [...held];
        if (command === 'services_ack') held.splice(0, held.length, ...held.filter((c) => !args!.ids.includes(c.id)));
    });
    return held;
}

let db: PGlite;
const titles = async () =>
    (await db.query<{ title: string }>('SELECT title FROM search_index ORDER BY title')).rows.map((r) => r.title);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => {
    await closeTestDatabase();
    vi.unstubAllGlobals();
});
beforeEach(async () => {
    await resetTestDatabase();
    invoke.mockReset();
    listen.mockReset();
    toast.success.mockReset();
    vi.stubGlobal('window', { __JOURNAL_NATIVE__: { platform: 'macos', plugins: [PLUGIN] } });
});

describe('serviceAction', () => {
    it('makes a new note from the selection: first line title, the rest body', () => {
        const c = call('new_note', '  Meeting notes\nship it\n');
        expect(serviceAction(c)).toEqual({
            id: c.id,
            type: 'new_note',
            text: 'Meeting notes\nship it',
            createdAt: new Date(c.createdAt).toISOString(),
            source: 'services',
        });
    });

    it("stores a URL selection as the share target's link note", () => {
        const url = 'https://example.com/a?b=c';
        expect(serviceAction(call('new_note', ` ${url} `)).text).toBe(`Shared Note\n${url}`);
        expect(sharedNote({ url })).toEqual({ title: 'Shared Note', content: url });
        // Text around a link is a note like any other.
        expect(serviceAction(call('new_note', `Read ${url}`)).text).toBe(`Read ${url}`);
    });

    it('appends the selection to today as it is', () => {
        const url = 'https://example.com';
        expect(serviceAction(call('append_today', url))).toMatchObject({ type: 'append_today', text: url });
    });
});

describe('importServiceCalls', () => {
    it('creates one note and one append, and acks them', async () => {
        const held = nativeQueue([call('new_note', 'Groceries\nmilk'), call('append_today', 'Ran 5k')]);
        await importServiceCalls();

        expect(held).toEqual([]);
        expect(await getActiveNoteByTitle('Groceries')).not.toBeNull();
        const today = await getActiveNoteByTitle(todayTitle());
        expect((await getSearchIndexEntry(today!.docId))?.plainTextContent).toContain('Ran 5k');
        expect(toast.success).toHaveBeenCalledWith('Saved to Journal');
    });

    it('imports a call exactly once when its ack was lost', async () => {
        const c = call('new_note', 'Once');
        nativeQueue([c]);
        await importServiceCalls();
        // The ack never reached the native queue: it hands the same call over again.
        const held = nativeQueue([c]);
        await importServiceCalls();

        expect((await titles()).filter((t) => t === 'Once')).toHaveLength(1);
        expect(held).toEqual([]);
    });
});

describe('importServiceCallsWhileMounted', () => {
    it('takes the calls held before the web was ready, then each new one', async () => {
        let onReceived: (() => void) | undefined;
        listen.mockImplementation(async (_event: string, handler: () => void) => {
            onReceived = handler;
            return () => {};
        });
        const held = nativeQueue([call('new_note', 'Sent at launch')]);
        const stop = importServiceCallsWhileMounted();
        await vi.waitFor(async () => expect(await getActiveNoteByTitle('Sent at launch')).not.toBeNull());
        expect(listen).toHaveBeenCalledWith('services://received', expect.any(Function));

        held.push(call('append_today', 'Later'));
        // Two events for one call import it once.
        onReceived!();
        onReceived!();
        await vi.waitFor(() => expect(held).toEqual([]));
        await flush();
        const today = await getActiveNoteByTitle(todayTitle());
        const text = (await getSearchIndexEntry(today!.docId))?.plainTextContent ?? '';
        expect(text.split('Later')).toHaveLength(2);
        expect(toast.success).toHaveBeenLastCalledWith("Added to today's note");
        stop();
    });

    it('does nothing on the web or without the plugin', () => {
        vi.stubGlobal('window', {});
        expect(hasMacServices()).toBe(false);
        importServiceCallsWhileMounted()();
        vi.stubGlobal('window', { __JOURNAL_NATIVE__: { platform: 'windows', plugins: [PLUGIN] } });
        expect(hasMacServices()).toBe(false);
        importServiceCallsWhileMounted()();
        expect(listen).not.toHaveBeenCalled();
        expect(invoke).not.toHaveBeenCalled();
    });
});
