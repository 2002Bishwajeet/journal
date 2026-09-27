import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as Y from 'yjs';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { DOC_BROADCAST_CHANNEL, type DocumentBroadcastMessage } from '@/lib/broadcast/DocumentBroadcast';

// Real DB, mocked at the pglite singleton boundary — same pattern as pglite_provider.test.ts.
vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));

/**
 * Two browser tabs open on the same note (issue #256). Each tab has its own
 * module graph — its own DocumentBroadcast singleton and BroadcastChannel —
 * over one shared database, so each "tab" here is a fresh import of the
 * provider after vi.resetModules(). Node's BroadcastChannel delivers between
 * the two channel instances just like two browser tabs.
 */
type Tab = {
    provider: import('@/lib/yjs/provider').PGliteProvider;
    doc: Y.Doc;
    broadcast: typeof import('@/lib/broadcast/DocumentBroadcast').documentBroadcast;
};

const DOC_ID = '22222222-2222-2222-2222-222222222222';

let db: PGlite;
const tabs: Tab[] = [];

async function openTab(): Promise<Tab> {
    vi.resetModules();
    // Must go through '@/lib/db/pglite' (not a direct import of './pgliteMock') so this
    // resolves to the SAME fresh mock instance PGliteProvider's own import gets below —
    // vi.resetModules() re-invokes the vi.mock factory per module graph, keyed by that path.
    const pglite = await import('@/lib/db/pglite') as unknown as typeof import('./pgliteMock');
    pglite.setTestDb(db);
    const { PGliteProvider } = await import('@/lib/yjs/provider');
    const { documentBroadcast } = await import('@/lib/broadcast/DocumentBroadcast');
    const doc = new Y.Doc();
    const provider = new PGliteProvider(DOC_ID, doc);
    await provider.load();
    const tab = { provider, doc, broadcast: documentBroadcast };
    tabs.push(tab);
    return tab;
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
    const start = Date.now();
    while (!cond() && Date.now() - start < ms) await new Promise(r => setTimeout(r, 10));
}

const tick = (ms = 100) => new Promise(r => setTimeout(r, ms));

beforeAll(async () => { db = await createTestDatabase(); });
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });
afterEach(async () => {
    for (const t of tabs.splice(0)) {
        await t.provider.destroy();
        t.doc.destroy();
        t.broadcast.destroy();
    }
});

describe('PGliteProvider across two tabs on the same note', () => {
    it('shows a local edit from tab A in tab B', async () => {
        const a = await openTab();
        const b = await openTab();

        a.doc.getText('body').insert(0, 'From A.');

        await waitFor(() => b.doc.getText('body').toString() === 'From A.');
        expect(b.doc.getText('body').toString()).toBe('From A.');
    });

    it('shows an edit in tab B when flush() persists it before the debounced save runs', async () => {
        const a = await openTab();
        const b = await openTab();

        a.doc.getText('body').insert(0, 'flushed');
        await a.provider.flush(); // takes the queue before handleUpdate's microtask

        await waitFor(() => b.doc.getText('body').toString() === 'flushed');
        expect(b.doc.getText('body').toString()).toBe('flushed');
    });

    it('announces a local edit once and does not echo it back from the receiving tab', async () => {
        const a = await openTab();
        const b = await openTab();
        const observer = new BroadcastChannel(DOC_BROADCAST_CHANNEL);
        const seen: DocumentBroadcastMessage[] = [];
        observer.onmessage = (e: MessageEvent<DocumentBroadcastMessage>) => { seen.push(e.data); };
        try {
            a.doc.getText('body').insert(0, 'x');
            a.doc.getText('body').insert(1, 'y');

            await waitFor(() => b.doc.getText('body').toString() === 'xy');
            await tick();

            expect(b.doc.getText('body').toString()).toBe('xy');
            // One burst -> one announcement; tab B's reload is not re-announced.
            expect(seen).toEqual([{ type: 'update', docId: DOC_ID }]);
        } finally {
            observer.close();
        }
    });

    it('keeps tab B\'s saved edit when tab A compacts before reloading it (#264)', async () => {
        const a = await openTab();
        const b = await openTab();
        a.broadcast.destroy(); // A never hears B's save, so it compacts without reloading

        b.doc.getText('body').insert(0, 'From B.');
        await b.provider.flush();
        a.doc.getText('body').insert(0, 'From A.');
        await a.provider.flush();

        await a.provider.compact();

        // B crashes: its in-memory copy is gone, only the database remains.
        tabs.splice(tabs.indexOf(b), 1);
        b.broadcast.destroy();
        b.doc.destroy();

        const { getDocumentUpdates } = await import('@/lib/db');
        const fresh = new Y.Doc();
        for (const u of await getDocumentUpdates(DOC_ID)) Y.applyUpdate(fresh, u);
        const body = fresh.getText('body').toString();
        fresh.destroy();
        expect(body).toContain('From B.');
        expect(body).toContain('From A.');
    });

    it('does not announce an update applied from a remote source', async () => {
        const a = await openTab();
        const observer = new BroadcastChannel(DOC_BROADCAST_CHANNEL);
        const seen: DocumentBroadcastMessage[] = [];
        observer.onmessage = (e: MessageEvent<DocumentBroadcastMessage>) => { seen.push(e.data); };
        try {
            const other = new Y.Doc();
            other.getText('body').insert(0, 'remote');
            a.provider.applyRemoteUpdate(Y.encodeStateAsUpdate(other));
            other.destroy();

            await tick();
            expect(a.doc.getText('body').toString()).toBe('remote');
            expect(seen).toEqual([]);
        } finally {
            observer.close();
        }
    });
});
