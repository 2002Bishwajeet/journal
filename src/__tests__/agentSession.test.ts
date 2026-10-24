// @vitest-environment happy-dom
/**
 * useAgentSession holds the ChatBot panel's state and behaviour (#699): per-note history,
 * command autocomplete, and one agent run per request over a fake engine.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentEngine, AgentMessage } from '@/lib/agent/loop/agentLoop';
import type { ReadDeps, NoteSummary } from '@/lib/agent/tools/read';

const PACKING: NoteSummary = {
    id: '00000000-0000-0000-0000-00000000000a',
    title: 'Packing list',
    folderId: 'folder-1',
    tags: [],
    modified: '2026-10-01T00:00:00.000Z',
};

const { engineHolder, entryHolder, outcomeHolder } = vi.hoisted(() => ({
    engineHolder: { current: null as unknown as AgentEngine },
    outcomeHolder: { current: 'accepted' as 'accepted' | 'rejected' | { notApplied: string } },
    entryHolder: { current: null as null | { docId: string; title: string; metadata: { excludeFromAI: boolean } } },
}));

vi.mock('@/hooks/useModelDownloadGate', () => ({
    useModelDownloadGate: () => ({
        confirmDownload: async () => true,
        dialogProps: { pending: null, onContinue: () => {}, onCancel: () => {} },
    }),
}));
vi.mock('@/lib/db', () => ({
    getSearchIndexEntry: vi.fn(async () => entryHolder.current),
}));
vi.mock('@/lib/agent/approveEdit', () => ({
    approveEdit: async () => outcomeHolder.current,
}));
vi.mock('@/lib/webllm', () => ({
    createAgentEngine: () => engineHolder.current,
}));
vi.mock('@/lib/agent/local/localDeps', () => ({
    createLocalDeps: (): ReadDeps => ({
        listFolders: async () => [{ id: 'folder-1', name: 'Main' }],
        loadGrants: async () => ({ version: 1, folders: { 'folder-1': 'write' }, notes: {} }),
        listNotes: async () => [PACKING],
        getNote: async (id) => (id === PACKING.id ? { summary: PACKING, markdown: 'passport, charger' } : null),
        searchNotes: async () => [{ summary: PACKING, snippet: 'passport' }],
    }),
}));

import { EditorState } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { editorSchema } from '@/lib/agent/editEngine';
import { registerActiveEditor } from '@/lib/agent/activeEditor';
import { useAgentSession } from '@/hooks/useAgentSession';
import { MAX_TOOL_STEPS } from '@/lib/agent/loop/agentLoop';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const answer = (text: string) => JSON.stringify({ answer: text });
const call = (tool: string, args: object) => JSON.stringify({ tool, args });

/** Replies with `script` in order and records what the model was asked. */
function scriptedEngine(script: string[]) {
    const requests: AgentMessage[][] = [];
    const generate = vi.fn(async (messages: AgentMessage[]) => {
        requests.push(messages);
        return script[requests.length - 1] ?? answer('script ran out');
    });
    engineHolder.current = { generate };
    return { requests, generate };
}

beforeEach(() => {
    localStorage.clear();
    entryHolder.current = { docId: PACKING.id, title: PACKING.title, metadata: { excludeFromAI: false } };
});

type Session = ReturnType<typeof useAgentSession>;

/** Mounts useAgentSession and keeps `latest.current` pointed at its newest return value. */
function mountSession() {
    const latest: { current: Session | null } = { current: null };
    function Harness({ noteId }: { noteId: string | undefined }) {
        latest.current = useAgentSession(noteId);
        return null;
    }

    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    const render = (noteId: string | undefined) => act(async () => { root.render(h(Harness, { noteId })); });
    const cleanup = async () => {
        await act(async () => root.unmount());
        el.remove();
    };
    const ask = async (text: string) => {
        await act(async () => { latest.current!.setInput(text); });
        await act(async () => { await latest.current!.send(); });
    };

    return { latest, render, cleanup, ask };
}

describe('useAgentSession — per-note history', () => {
    it('keeps history separate per note id and restores it when switching back', async () => {
        scriptedEngine([]);
        const { latest, render, cleanup, ask } = mountSession();
        await render('note-a');

        await ask('/help');
        expect(latest.current!.messages).toHaveLength(2);
        expect(latest.current!.messages[0]).toMatchObject({ role: 'user', content: '/help' });

        await render('note-b');
        expect(latest.current!.messages).toEqual([]);

        await render('note-a');
        expect(latest.current!.messages).toHaveLength(2);

        await cleanup();
    });

    it('/clear empties the history', async () => {
        scriptedEngine([answer('Hello')]);
        const { latest, render, cleanup, ask } = mountSession();
        await render('note-a');

        await ask('hi');
        expect(latest.current!.messages).toHaveLength(2);

        await ask('/clear');
        expect(latest.current!.messages).toEqual([]);

        await cleanup();
    });
});

describe('useAgentSession — commands', () => {
    it('offers /summarize, /clear and /help, and no web search', async () => {
        scriptedEngine([]);
        const { latest, render, cleanup } = mountSession();
        await render('note-a');

        await act(async () => { latest.current!.setInput('/'); });
        expect(latest.current!.suggestions.open).toBe(true);
        expect(latest.current!.suggestions.items.map((c) => c.label)).toEqual(['/summarize', '/clear', '/help']);

        await act(async () => { latest.current!.setInput('/se'); });
        expect(latest.current!.suggestions.items).toEqual([]);

        await cleanup();
    });

    it('/summarize sends the summarize request with the open note as context', async () => {
        const { requests } = scriptedEngine([answer('A packing list.')]);
        const { latest, render, cleanup, ask } = mountSession();
        await render(PACKING.id);

        await ask('/summarize');

        const user = requests[0].find((m) => m.role === 'user')!;
        expect(user.content).toContain('Summarize the open note');
        expect(user.content).toContain(`"Packing list" (id: ${PACKING.id})`);
        expect(latest.current!.messages.map((m) => m.content)).toEqual(['/summarize', 'A packing list.']);

        await cleanup();
    });

    it('does not name an excludeFromAI note to the model', async () => {
        entryHolder.current = { docId: PACKING.id, title: 'Secret plan', metadata: { excludeFromAI: true } };
        const { requests } = scriptedEngine([answer('Nothing to say.')]);
        const { render, cleanup, ask } = mountSession();
        await render(PACKING.id);

        await ask('what is this about?');

        expect(JSON.stringify(requests)).not.toContain('Secret plan');

        await cleanup();
    });
});

describe('useAgentSession — steps', () => {
    it('lists each tool call in plain words, with the note title as a link target', async () => {
        scriptedEngine([call('search_notes', { query: 'packing' }), call('get_note', { id: PACKING.id }), answer('A passport.')]);
        const { latest, render, cleanup, ask } = mountSession();
        await render('note-a');

        await ask('what did I pack?');

        const reply = latest.current!.messages[1];
        expect(reply.content).toBe('A passport.');
        expect(reply.pending).toBe(false);
        expect(reply.steps).toEqual([
            { before: "Searched notes for 'packing'", after: '', open: false },
            { before: "Read '", note: { title: 'Packing list', href: `/folder-1/${PACKING.id}` }, after: "'", open: false },
        ]);

        await cleanup();
    });

    it('shows a not-found step for a note the agent cannot see', async () => {
        const hidden = '00000000-0000-0000-0000-0000000000ff';
        scriptedEngine([call('get_note', { id: hidden }), answer('I could not find it.')]);
        const { latest, render, cleanup, ask } = mountSession();
        await render('note-a');

        await ask('read the hidden note');

        const { steps } = latest.current!.messages[1];
        expect(steps).toHaveLength(1);
        expect(steps![0].before).toBe('Could not finish a step: Note not found');

        await cleanup();
    });

    it('says so when the step cap is hit', async () => {
        const calls = Array.from({ length: MAX_TOOL_STEPS }, () => call('list_folders', {}));
        scriptedEngine([...calls, answer('Some folders.')]);
        const { latest, render, cleanup, ask } = mountSession();
        await render('note-a');

        await ask('what folders?');

        expect(latest.current!.messages[1].content).toContain(`I stopped after ${MAX_TOOL_STEPS} steps`);

        await cleanup();
    });
});

describe('useAgentSession — edits to the open note', () => {
    it.each([
        ['accepted', 'Accepted: Make paragraph 1 bold'],
        ['rejected', 'Rejected: Make paragraph 1 bold'],
        [{ notApplied: 'gone' }, 'Not applied: Make paragraph 1 bold'],
    ] as const)('ends the edit step as %j', async (outcome, text) => {
        outcomeHolder.current = outcome;
        const doc = editorSchema.nodeFromJSON({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
        });
        const off = registerActiveEditor({
            docId: 'note-a',
            editor: { state: EditorState.create({ doc }) } as unknown as Editor,
            editable: true,
            excludeFromAI: false,
        });
        scriptedEngine([call('format_text', { n: 1, mark: 'bold', on: true }), answer('Done.')]);
        const { latest, render, cleanup, ask } = mountSession();
        await render('note-a');

        await ask('bold it');

        expect(latest.current!.messages[1].steps).toEqual([
            { before: text, after: '', open: false },
        ]);

        off();
        await cleanup();
    });
});

describe('useAgentSession — Stop', () => {
    it('ends the turn and keeps the panel usable', async () => {
        let started!: () => void;
        const generating = new Promise<void>((resolve) => { started = resolve; });
        engineHolder.current = {
            generate: (_messages, { signal }) =>
                new Promise((resolve) => {
                    started();
                    signal?.addEventListener('abort', () => resolve(''));
                }),
        };
        const { latest, render, cleanup, ask } = mountSession();
        await render('note-a');

        let asked!: Promise<void>;
        await act(async () => { latest.current!.setInput('slow question'); });
        await act(async () => { asked = latest.current!.send(); await generating; });
        expect(latest.current!.isGenerating).toBe(true);

        await act(async () => { latest.current!.stop(); await asked; });

        expect(latest.current!.isGenerating).toBe(false);
        expect(latest.current!.messages[1]).toMatchObject({ content: 'Stopped.', pending: false });

        engineHolder.current = { generate: async () => answer('Back again.') };
        await ask('next question');
        expect(latest.current!.messages.at(-1)!.content).toBe('Back again.');

        await cleanup();
    });
});
