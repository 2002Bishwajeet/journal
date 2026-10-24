// @vitest-environment happy-dom
/**
 * #705: Journal's tools over WebMCP. A fake `modelContext` records what is registered; the
 * grants decide what the browser's agent can see, and an edit tool resolves only after the
 * user answers the preview.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createTrackedEditor } from './trackedEditor';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { createCollaborationExtension } from '@/components/editor/plugins/collaboration';
import { registerActiveEditor } from '@/lib/agent/activeEditor';
import type { EditOutcome } from '@/lib/agent/approveEdit';
import type { AgentGrants } from '@/lib/agent/grants';
import { TOOLS, toJsonSchema } from '@/lib/agent/tools/registry';
import type { NoteSummary, ReadDeps } from '@/lib/agent/tools/read';
import { addOriginTrialToken, getModelContext, type ModelContext, type WebMcpTool } from '@/lib/agent/modelContext';
import { startWebMcp } from '@/lib/agent/webmcp';
import { WEBMCP_ENABLED_KEY } from '@/lib/storage';

const { startSpy } = vi.hoisted(() => ({ startSpy: vi.fn() }));
vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => ({}) }));
vi.mock('@/lib/agent/local/localDeps', () => ({ createLocalDeps: () => ({}) }));
vi.mock('@/lib/agent/webmcp', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/agent/webmcp')>();
    return { startWebMcp: (...args: Parameters<typeof original.startWebMcp>) => (startSpy(...args), original.startWebMcp(...args)) };
});

import { useWebMcpBridge, useWebMcpSetting } from '@/hooks/useWebMcp';

const note = (id: string, title: string, folderId: string, excludeFromAI = false): NoteSummary => ({
    id,
    title,
    folderId,
    tags: [],
    modified: '2026-10-01T00:00:00.000Z',
    excludeFromAI,
});

const GRANTED = note('note-granted', 'Packing list', 'f-read');
const WRITABLE = note('note-writable', 'Trip plan', 'f-write');
const HIDDEN = note('note-hidden', 'Private diary', 'f-none');
const EXCLUDED = note('note-excluded', 'Secret', 'f-read', true);
const NOTES = [GRANTED, WRITABLE, HIDDEN, EXCLUDED];

let grants: AgentGrants;
const resetGrants = () => {
    grants = { version: 1, folders: { 'f-read': 'read', 'f-write': 'write' }, notes: {} };
};
resetGrants();

const deps: ReadDeps = {
    loadGrants: async () => grants,
    listFolders: async () => [
        { id: 'f-read', name: 'Read' },
        { id: 'f-write', name: 'Write' },
        { id: 'f-none', name: 'Private' },
    ],
    listNotes: async () => NOTES,
    getNote: async (id) => {
        const found = NOTES.find((n) => n.id === id);
        return found ? { summary: found, markdown: `# ${found.title}\n\nbody of ${found.title}` } : null;
    },
};

interface Registration {
    tool: WebMcpTool;
    signal: AbortSignal;
}

function fakeModelContext() {
    const registrations: Registration[] = [];
    const modelContext: ModelContext = {
        registerTool(tool, options) {
            registrations.push({ tool, signal: options!.signal! });
            return Promise.resolve();
        },
    };
    const live = () => registrations.filter((r) => !r.signal.aborted);
    const names = () => live().map((r) => r.tool.name);
    const call = (name: string, args: unknown) => live().find((r) => r.tool.name === name)!.tool.execute(args);
    return { modelContext, registrations, names, call };
}

let editor: Editor | null = null;
let unregister: (() => void) | null = null;

function openNote(entry: NoteSummary, html = '<p>one</p><p>two</p>', flags: { editable?: boolean } = {}) {
    editor = createTrackedEditor({
        element: document.body.appendChild(document.createElement('div')),
        extensions: [...createBaseExtensions(), createCollaborationExtension(new Y.Doc().getXmlFragment('prosemirror'))],
    });
    editor.commands.setContent(html);
    unregister = registerActiveEditor({ docId: entry.id, editor, editable: flags.editable ?? true, excludeFromAI: entry.excludeFromAI === true });
}

afterEach(() => {
    unregister?.();
    unregister = null;
    editor = null;
    document.body.replaceChildren();
    delete (document as unknown as { modelContext?: unknown }).modelContext;
    delete (navigator as unknown as { modelContext?: unknown }).modelContext;
    localStorage.clear();
    startSpy.mockClear();
    resetGrants();
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const outcomeNever = () => new Promise<EditOutcome>(() => {});

describe('getModelContext', () => {
    it('is null without the API, and finds document.modelContext or navigator.modelContext', () => {
        expect(getModelContext()).toBeNull();
        const fake = fakeModelContext().modelContext;
        Object.defineProperty(navigator, 'modelContext', { value: fake, configurable: true });
        expect(getModelContext()).toBe(fake);
        const preferred = fakeModelContext().modelContext;
        Object.defineProperty(document, 'modelContext', { value: preferred, configurable: true });
        expect(getModelContext()).toBe(preferred);
    });

    it('ignores an object with no registerTool', () => {
        Object.defineProperty(document, 'modelContext', { value: {}, configurable: true });
        expect(getModelContext()).toBeNull();
    });
});

describe('addOriginTrialToken', () => {
    it('adds the meta tag only when there is a token', () => {
        addOriginTrialToken(undefined);
        expect(document.head.querySelector('meta[http-equiv="origin-trial"]')).toBeNull();
        addOriginTrialToken('abc123');
        expect(document.head.querySelector('meta[http-equiv="origin-trial"]')?.getAttribute('content')).toBe('abc123');
        document.head.querySelector('meta[http-equiv="origin-trial"]')?.remove();
    });
});

describe('startWebMcp', () => {
    it('registers exactly the note tools, with the registry schemas and a read-only hint', async () => {
        const fake = fakeModelContext();
        await startWebMcp({ modelContext: fake.modelContext, deps });
        expect(fake.names()).toEqual(['list_folders', 'list_notes', 'search_notes', 'get_note']);
        for (const { tool } of fake.registrations) {
            expect(tool.annotations?.readOnlyHint).toBe(true);
            const registry = TOOLS.find((t) => t.name === tool.name)!;
            // get_note drops the "blocks" format, which reads through WriteDeps.
            if (tool.name === 'get_note') expect((tool.inputSchema as { properties: object }).properties).toEqual({ id: { type: 'string' } });
            else expect(tool.inputSchema).toEqual(toJsonSchema(registry));
        }
    });

    it('returns a granted note as JSON text, and "Note not found" for an ungranted or excluded one', async () => {
        const fake = fakeModelContext();
        await startWebMcp({ modelContext: fake.modelContext, deps });

        const granted = JSON.parse(await fake.call('get_note', { id: GRANTED.id }));
        expect(granted).toMatchObject({ id: GRANTED.id, access: 'read', markdown: '# Packing list\n\nbody of Packing list' });
        await expect(fake.call('get_note', { id: HIDDEN.id })).rejects.toThrow('Note not found');
        await expect(fake.call('get_note', { id: EXCLUDED.id })).rejects.toThrow('Note not found');

        const listed = JSON.parse(await fake.call('list_notes', {})) as { id: string }[];
        expect(listed.map((n) => n.id).sort()).toEqual([GRANTED.id, WRITABLE.id].sort());
        const folders = JSON.parse(await fake.call('list_folders', {})) as { id: string }[];
        expect(folders.map((f) => f.id)).toEqual(['f-read', 'f-write']);
    });

    it('reads the grants on every call, so a revoked grant takes effect at once', async () => {
        const fake = fakeModelContext();
        await startWebMcp({ modelContext: fake.modelContext, deps });
        await fake.call('get_note', { id: GRANTED.id });
        grants = { ...grants, folders: { 'f-write': 'write' } };
        await expect(fake.call('get_note', { id: GRANTED.id })).rejects.toThrow('Note not found');
    });

    it('takes arguments as an object or a JSON string, and rejects bad ones', async () => {
        const fake = fakeModelContext();
        await startWebMcp({ modelContext: fake.modelContext, deps });
        const asObject = await fake.call('get_note', { id: GRANTED.id });
        expect(await fake.call('get_note', JSON.stringify({ id: GRANTED.id }))).toBe(asObject);
        expect(JSON.parse(await fake.call('list_folders', ''))).toHaveLength(2);
        await expect(fake.call('get_note', '{not json')).rejects.toThrow('must be a JSON object');
        await expect(fake.call('get_note', {})).rejects.toThrow('Invalid arguments for get_note');
    });

    it('registers the open-note tools only while the open note is granted Read + write', async () => {
        const fake = fakeModelContext();
        const handle = await startWebMcp({ modelContext: fake.modelContext, deps });

        openNote(GRANTED);
        await tick();
        expect(fake.names()).not.toContain('read_open_note');

        unregister!();
        openNote(WRITABLE);
        await handle.sync();
        expect(fake.names()).toEqual(['list_folders', 'list_notes', 'search_notes', 'get_note', 'read_open_note', 'insert_paragraph', 'set_block_type', 'replace_text', 'format_text']);
        expect(fake.registrations.find((r) => r.tool.name === 'format_text')!.tool.annotations?.readOnlyHint).toBe(false);
        expect(JSON.parse(await fake.call('read_open_note', {}))).toEqual([
            { n: 1, type: 'paragraph', text: 'one' },
            { n: 2, type: 'paragraph', text: 'two' },
        ]);

        // Closing the note, or an excluded or read-only note, takes them away again.
        unregister!();
        unregister = null;
        await handle.sync();
        expect(fake.names()).toEqual(['list_folders', 'list_notes', 'search_notes', 'get_note']);

        openNote(WRITABLE, '<p>x</p>', { editable: false });
        await handle.sync();
        expect(fake.names()).not.toContain('read_open_note');
    });

    it('does not offer the open-note tools for an ungranted or excluded note', async () => {
        const fake = fakeModelContext();
        const handle = await startWebMcp({ modelContext: fake.modelContext, deps });
        openNote(EXCLUDED);
        await handle.sync();
        unregister!();
        openNote(HIDDEN);
        await handle.sync();
        expect(fake.names()).not.toContain('read_open_note');
    });

    it('resolves an edit tool only after the user answers, and changes nothing itself', async () => {
        const fake = fakeModelContext();
        let answer!: (outcome: EditOutcome) => void;
        const approve = vi.fn(() => new Promise<EditOutcome>((resolve) => (answer = resolve)));
        const handle = await startWebMcp({ modelContext: fake.modelContext, deps, approve });
        openNote(WRITABLE);
        await handle.sync();
        const before = editor!.getJSON();

        let settled = false;
        const result = fake.call('format_text', JSON.stringify({ n: 2, mark: 'bold', on: true })).then((value) => ((settled = true), value));
        await vi.waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
        await tick();
        expect(settled).toBe(false);
        expect(editor!.getJSON()).toEqual(before);

        answer('accepted');
        expect(JSON.parse(await result)).toEqual({ outcome: 'accepted', summary: 'Make paragraph 2 bold' });

        const rejected = fake.call('replace_text', { n: 1, find: 'one', replace: 'uno' });
        await vi.waitFor(() => expect(approve).toHaveBeenCalledTimes(2));
        answer('rejected');
        expect(JSON.parse(await rejected)).toMatchObject({ outcome: 'rejected by the user' });
        expect(editor!.getJSON()).toEqual(before);
    });

    it('refuses an edit when the grant was lowered after the tools were registered', async () => {
        const fake = fakeModelContext();
        const approve = vi.fn(outcomeNever);
        const handle = await startWebMcp({ modelContext: fake.modelContext, deps, approve });
        openNote(WRITABLE);
        await handle.sync();
        grants = { ...grants, folders: { ...grants.folders, 'f-write': 'read' } };
        await expect(fake.call('insert_paragraph', { after: 0, text: 'hi' })).rejects.toThrow('not granted for editing');
        await expect(fake.call('read_open_note', {})).rejects.toThrow('not granted for editing');
        expect(approve).not.toHaveBeenCalled();
        // Once the grant change is noticed, the tools go.
        await handle.sync();
        expect(fake.names()).not.toContain('insert_paragraph');
    });

    it('aborts every registration on stop', async () => {
        const fake = fakeModelContext();
        const handle = await startWebMcp({ modelContext: fake.modelContext, deps });
        openNote(WRITABLE);
        await handle.sync();
        expect(fake.registrations).toHaveLength(9);
        expect(fake.names()).toHaveLength(9);

        handle.stop();
        expect(fake.names()).toEqual([]);
        expect(fake.registrations.every((r) => r.signal.aborted)).toBe(true);

        // A note opened afterwards registers nothing.
        unregister!();
        openNote(WRITABLE);
        await tick();
        await handle.sync();
        expect(fake.registrations).toHaveLength(9);
    });
});

describe('useWebMcpBridge', () => {
    beforeAll(() => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    });

    async function mount() {
        let setting!: ReturnType<typeof useWebMcpSetting>;
        function Probe() {
            useWebMcpBridge();
            setting = useWebMcpSetting();
            return null;
        }
        const root = createRoot(document.body.appendChild(document.createElement('div')));
        await act(async () => root.render(h(QueryClientProvider, { client: new QueryClient() }, h(Probe))));
        return { setting: () => setting, unmount: () => act(async () => root.unmount()) };
    }
    const flush = () => act(async () => void (await tick()));

    it('registers nothing while the switch is off', async () => {
        const fake = fakeModelContext();
        Object.defineProperty(document, 'modelContext', { value: fake.modelContext, configurable: true });
        const view = await mount();
        await flush();
        expect(view.setting().supported).toBe(true);
        expect(view.setting().enabled).toBe(false);
        expect(startSpy).not.toHaveBeenCalled();
        expect(fake.registrations).toHaveLength(0);
        await view.unmount();
    });

    it('registers nothing when the browser has no WebMCP, even with the switch on', async () => {
        localStorage.setItem(WEBMCP_ENABLED_KEY, 'true');
        const view = await mount();
        await flush();
        expect(view.setting().supported).toBe(false);
        expect(startSpy).not.toHaveBeenCalled();
        await view.unmount();
    });

    it('registers when the switch goes on and aborts every signal when it goes off', async () => {
        const fake = fakeModelContext();
        Object.defineProperty(document, 'modelContext', { value: fake.modelContext, configurable: true });
        const view = await mount();

        await act(async () => view.setting().setEnabled(true));
        await vi.waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(fake.registrations.length).toBeGreaterThan(0));
        expect(localStorage.getItem(WEBMCP_ENABLED_KEY)).toBe('true');

        await act(async () => view.setting().setEnabled(false));
        expect(fake.registrations.every((r) => r.signal.aborted)).toBe(true);
        await view.unmount();
    });
});
