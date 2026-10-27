/**
 * #702: the in-app agent appends to a note that is not open and creates notes, over the real
 * PGlite schema. Nothing is written until Accept; an accepted write is saved the way the app
 * saves an edit (Yjs update, search index, pending sync, snapshot, broadcast).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import {
    createFolder,
    getDocumentUpdates,
    getSearchIndexEntry,
    getSnapshots,
    getSyncRecord,
    saveDocumentUpdate,
    upsertSearchIndex,
    upsertSyncRecord,
} from '@/lib/db/queries';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';
import { documentBroadcast } from '@/lib/broadcast/DocumentBroadcast';
import { appendMarkdown, toMarkdown } from '@/lib/agent/editEngine';
import { createLocalWriteDeps } from '@/lib/agent/local/localWriteDeps';
import { loadLocalYDoc } from '@/lib/yjs/loadDoc';
import { acceptWrite, approveWrite, pendingWrites, rejectWrite } from '@/lib/agent/approveWrite';
import { AGENT_TOOLS, runAgent, type AgentEngine, type AgentEvent } from '@/lib/agent/loop/agentLoop';
import type { EditOutcome } from '@/lib/agent/approveEdit';
import type { ActiveEditor } from '@/lib/agent/activeEditor';
import type { AnyJournalTool } from '@/lib/agent/tools/registry';

const FOLDER = '10000000-0000-0000-0000-000000000001';
const PACKING = '30000000-0000-0000-0000-000000000001';
const EXCLUDED = '30000000-0000-0000-0000-000000000002';
const TRASHED = '30000000-0000-0000-0000-000000000003';
const OPEN = '30000000-0000-0000-0000-000000000004';

async function addNote(docId: string, title: string, body: string, extra: { excludeFromAI?: boolean; archivalStatus?: number } = {}) {
    const now = new Date().toISOString();
    await upsertSearchIndex({
        docId,
        title,
        plainTextContent: body,
        metadata: {
            title,
            folderId: FOLDER,
            timestamps: { created: now, modified: now },
            excludeFromAI: extra.excludeFromAI ?? false,
            archivalStatus: extra.archivalStatus,
        },
    });
    const doc = new Y.Doc();
    appendMarkdown(doc, body);
    await saveDocumentUpdate(docId, Y.encodeStateAsUpdate(doc));
    await upsertSyncRecord({ localId: docId, entityType: 'note', syncStatus: 'synced', remoteFileId: `file-${docId}`, versionTag: 'v1' });
}

/** Replies with `script` in order. */
function scriptedEngine(script: object[]): AgentEngine {
    let i = 0;
    return {
        generate: vi.fn(async () => {
            const next = script[i++];
            if (next === undefined) throw new Error('script ran out');
            return JSON.stringify(next);
        }),
    };
}

/** Runs the agent over the local write deps; `answerWith` decides each proposal. */
function run(request: string, script: object[], answerWith: 'accept' | 'reject', openNoteId?: string) {
    const events: AgentEvent[] = [];
    const result = runAgent(request, {
        engine: scriptedEngine(script),
        deps: createLocalWriteDeps(),
        writeDeps: createLocalWriteDeps(),
        editor: { get: () => (openNoteId ? ({ docId: openNoteId } as ActiveEditor) : null), subscribe: () => () => {} },
        approve: async (proposal): Promise<EditOutcome> => {
            const asked = approveWrite(proposal.write!);
            const item = pendingWrites.current()!;
            if (answerWith === 'accept') await acceptWrite(item);
            else rejectWrite(item);
            return asked;
        },
        onEvent: (event) => events.push(event),
    });
    return { result, events };
}

const appendCall = (id: string, markdown = 'buy socks') => ({ tool: 'append_to_note', args: { id, markdown } });
const markdownOf = async (id: string) => toMarkdown((await loadLocalYDoc(id))!);

let notified: string[];

beforeAll(async () => {
    setTestDb(await createTestDatabase());
});
afterAll(async () => {
    await closeTestDatabase();
});
beforeEach(async () => {
    await resetTestDatabase();
    await createFolder(FOLDER, 'Home');
    await addNote(PACKING, 'Packing list', 'Passport and charger.');
    await addNote(EXCLUDED, 'Private diary', 'Secret.', { excludeFromAI: true });
    await addNote(TRASHED, 'Old list', 'Gone.', { archivalStatus: 2 });
    await addNote(OPEN, 'Open note', 'Being edited.');
    notified = [];
    vi.spyOn(documentBroadcast, 'notifyDocumentUpdated').mockImplementation((id) => void notified.push(id));
});
afterEach(() => {
    vi.restoreAllMocks();
});

describe('append_to_note on a note that is not open', () => {
    it('is in AGENT_TOOLS, within the limit of 8', () => {
        expect(AGENT_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(['append_to_note', 'create_note']));
        expect(AGENT_TOOLS.length).toBeLessThanOrEqual(8);
    });

    it('asks first and writes nothing until Accept', async () => {
        const updatesBefore = await getDocumentUpdates(PACKING);
        const events: AgentEvent[] = [];
        const result = runAgent('add buy socks to my packing list', {
            engine: scriptedEngine([appendCall(PACKING), { answer: 'Done.' }]),
            deps: createLocalWriteDeps(),
            writeDeps: createLocalWriteDeps(),
            approve: async (proposal) => {
                events.push({ type: 'proposal', proposal });
                expect(await getDocumentUpdates(PACKING)).toEqual(updatesBefore);
                expect(await getSnapshots(PACKING)).toHaveLength(0);
                return 'rejected';
            },
        });
        await result;
        expect(events).toHaveLength(1);
        const proposal = (events[0] as Extract<AgentEvent, { type: 'proposal' }>).proposal;
        expect(proposal.summary).toBe("Append to 'Packing list'");
        expect(proposal.write?.markdown).toBe('buy socks');
    });

    it('on Accept merges the line into the stored doc, updates the index, marks it pending, saves a snapshot and tells other tabs', async () => {
        const before = await getSyncRecord(PACKING);
        expect(before?.syncStatus).toBe('synced');

        const { result, events } = run('add buy socks', [appendCall(PACKING), { answer: 'Added it.' }], 'accept');
        expect(await result).toBe('Added it.');

        expect(await markdownOf(PACKING)).toContain('Passport and charger.');
        expect(await markdownOf(PACKING)).toContain('buy socks');

        const entry = await getSearchIndexEntry(PACKING);
        expect(entry?.plainTextContent).toContain('buy socks');
        expect(entry?.metadata.lastEditedBy).toBe('agent:journal-assistant');
        expect(Date.parse(entry!.metadata.timestamps.modified)).toBeGreaterThan(Date.parse(entry!.metadata.timestamps.created) - 1);

        const sync = await getSyncRecord(PACKING);
        expect(sync?.syncStatus).toBe('pending');
        // The link to the Homebase file is kept.
        expect(sync?.remoteFileId).toBe(`file-${PACKING}`);

        // The snapshot is the note as it was before the edit.
        const snapshots = await getSnapshots(PACKING);
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0].preview).toContain('Passport and charger.');
        expect(snapshots[0].preview).not.toContain('buy socks');

        expect(notified).toEqual([PACKING]);

        const toolResult = events.find((e) => e.type === 'toolResult') as Extract<AgentEvent, { type: 'toolResult' }>;
        expect(toolResult.result).toBe(`accepted (note id: ${PACKING})`);
        expect(toolResult.note).toEqual({ id: PACKING, title: 'Packing list', folderId: FOLDER });
    });

    it('stores only the diff as a new update', async () => {
        const updatesBefore = await getDocumentUpdates(PACKING);
        const { result } = run('add', [appendCall(PACKING), { answer: 'ok' }], 'accept');
        await result;
        const updates = await getDocumentUpdates(PACKING);
        expect(updates).toHaveLength(updatesBefore.length + 1);
        expect(updates.at(-1)!.length).toBeLessThan(Y.encodeStateAsUpdate((await loadLocalYDoc(PACKING))!).length);
    });

    it('on Reject changes nothing', async () => {
        const updatesBefore = await getDocumentUpdates(PACKING);
        const entryBefore = await getSearchIndexEntry(PACKING);

        const { result, events } = run('add', [appendCall(PACKING), { answer: 'Left it.' }], 'reject');
        await result;

        expect(await getDocumentUpdates(PACKING)).toEqual(updatesBefore);
        expect(await getSearchIndexEntry(PACKING)).toEqual(entryBefore);
        expect((await getSyncRecord(PACKING))?.syncStatus).toBe('synced');
        expect(await getSnapshots(PACKING)).toHaveLength(0);
        expect(notified).toEqual([]);
        const toolResult = events.find((e) => e.type === 'toolResult') as Extract<AgentEvent, { type: 'toolResult' }>;
        expect(toolResult.result).toBe('rejected by the user');
    });

    it.each([
        ['an excludeFromAI note', EXCLUDED, 'Note not found'],
        ['a trashed note', TRASHED, 'Note not found'],
        ['a missing note', '30000000-0000-0000-0000-0000000000ff', 'Note not found'],
    ])('refuses %s without asking', async (_name, id, message) => {
        const { result, events } = run('add', [appendCall(id), { answer: 'Could not.' }], 'accept');
        await result;
        expect(events.some((e) => e.type === 'proposal')).toBe(false);
        expect(events.find((e) => e.type === 'error')).toMatchObject({ error: expect.stringContaining(message) });
    });

    it('never writes the open note through the notes store: its append goes through the editor (#914)', async () => {
        const { result, events } = run('add', [appendCall(OPEN), { answer: 'Could not.' }], 'accept', OPEN);
        await result;
        expect(events.some((e) => e.type === 'proposal' && e.proposal.write)).toBe(false);
        expect(await markdownOf(OPEN)).not.toContain('buy socks');
    });

    it('does not apply an accepted append when the note became excluded meanwhile', async () => {
        const write = createLocalWriteDeps();
        const { proposeWrite } = await import('@/lib/agent/loop/proposeWrite');
        const append = AGENT_TOOLS.find((t) => t.name === 'append_to_note')!;
        const proposal = await proposeWrite(append as AnyJournalTool, { id: PACKING, markdown: 'late' }, { deps: write, writeDeps: write });

        const entry = (await getSearchIndexEntry(PACKING))!;
        await upsertSearchIndex({ ...entry, metadata: { ...entry.metadata, excludeFromAI: true } });

        const asked = approveWrite(proposal);
        const outcome = await acceptWrite(pendingWrites.current()!);
        expect(outcome).toEqual({ notApplied: expect.stringContaining('Note not found') });
        expect(await asked).toEqual(outcome);
        expect(await markdownOf(PACKING)).not.toContain('late');
    });
});

describe('create_note', () => {
    const createCall = (args: object) => ({ tool: 'create_note', args: { title: 'Ideas', markdown: '- first idea', ...args } });

    it('on Accept makes a note in Main, indexed, pending sync, with its body', async () => {
        const { result, events } = run('make a note of ideas', [createCall({}), { answer: 'Made it.' }], 'accept');
        await result;

        const proposal = (events.find((e) => e.type === 'proposal') as Extract<AgentEvent, { type: 'proposal' }>).proposal;
        expect(proposal.summary).toBe("Create note 'Ideas' in Main");

        const toolResult = events.find((e) => e.type === 'toolResult') as Extract<AgentEvent, { type: 'toolResult' }>;
        const id = toolResult.note!.id;
        expect(toolResult.note).toMatchObject({ title: 'Ideas', folderId: MAIN_FOLDER_ID });

        const entry = await getSearchIndexEntry(id);
        expect(entry?.title).toBe('Ideas');
        expect(entry?.metadata.folderId).toBe(MAIN_FOLDER_ID);
        expect(entry?.plainTextContent).toContain('first idea');
        expect(await markdownOf(id)).toContain('first idea');
        expect((await getSyncRecord(id))?.syncStatus).toBe('pending');
    });

    it('puts the note in the folder named, and writes nothing on Reject', async () => {
        const { result, events } = run('note', [createCall({ folderId: FOLDER }), { answer: 'Left it.' }], 'reject');
        await result;
        const proposal = (events.find((e) => e.type === 'proposal') as Extract<AgentEvent, { type: 'proposal' }>).proposal;
        expect(proposal.summary).toBe("Create note 'Ideas' in Home");
        const rows = await (await import('@/lib/db/pglite')).getDatabase();
        const { rows: notes } = await rows!.query('SELECT doc_id FROM search_index WHERE title = $1', ['Ideas']);
        expect(notes).toHaveLength(0);
    });

    it('refuses a folder that does not exist without asking', async () => {
        const { result, events } = run('note', [createCall({ folderId: 'nope' }), { answer: 'Could not.' }], 'accept');
        await result;
        expect(events.some((e) => e.type === 'proposal')).toBe(false);
        expect(events.find((e) => e.type === 'error')).toMatchObject({ error: expect.stringContaining('Folder not found') });
    });

    it('refuses a body image: images stay MCP-only', async () => {
        const png = 'data:image/png;base64,iVBORw0KGgo=';
        const { result, events } = run('note', [createCall({ markdown: `![x](${png})` }), { answer: 'Could not.' }], 'accept');
        await result;
        expect(events.some((e) => e.type === 'proposal')).toBe(false);
        expect(events.find((e) => e.type === 'error')).toMatchObject({ error: expect.stringContaining("Images can't be added here") });
    });
});
