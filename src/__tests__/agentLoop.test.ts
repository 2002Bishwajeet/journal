/**
 * The local agent loop (#698) with a scripted engine over real local deps on PGlite (#697).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { z } from 'zod';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { upsertSearchIndex, saveDocumentUpdate, createFolder } from '@/lib/db/queries';
import { createLocalDeps } from '@/lib/agent/local/localDeps';
import { appendMarkdown } from '@/lib/agent/editEngine';
import type { AnyJournalTool } from '@/lib/agent/tools/registry';
import { EditorState } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { editorSchema } from '@/lib/agent/editEngine';
import type { ActiveEditorStore } from '@/lib/agent/activeEditor';
import {
    AGENT_TOOLS,
    FORMAT_FAILED,
    MAX_TOKENS,
    MAX_TOOL_STEPS,
    runAgent,
    turnSchema,
    type AgentEngine,
    type AgentEvent,
    type AgentMessage,
    type RunAgentOptions,
} from '@/lib/agent/loop/agentLoop';
import { CONTEXT_WINDOW, estimatePrompt, estimateTokens } from '@/lib/agent/loop/trim';

const FOLDER = '10000000-0000-0000-0000-000000000001';
const GARDEN = '30000000-0000-0000-0000-000000000001';

async function addNote(docId: string, title: string, body: string) {
    const now = new Date().toISOString();
    await upsertSearchIndex({
        docId,
        title,
        plainTextContent: body,
        metadata: { title, folderId: FOLDER, timestamps: { created: now, modified: now }, excludeFromAI: false },
    });
    const doc = new Y.Doc();
    appendMarkdown(doc, body);
    await saveDocumentUpdate(docId, Y.encodeStateAsUpdate(doc));
}

interface Call {
    messages: AgentMessage[];
    schema: { anyOf?: { properties: { tool?: { const: string } } }[] };
}

/** Replies with `script` in order and records every call. */
function scriptedEngine(script: (string | object)[]) {
    const calls: Call[] = [];
    const engine: AgentEngine = {
        generate: vi.fn(async (messages, { schema }) => {
            calls.push({ messages, schema: schema as Call['schema'] });
            const next = script[calls.length - 1];
            if (next === undefined) throw new Error('script ran out');
            return typeof next === 'string' ? next : JSON.stringify(next);
        }),
    };
    return { engine, calls };
}

function run(request: string, engine: AgentEngine, extra: Partial<RunAgentOptions> = {}) {
    const events: AgentEvent[] = [];
    const result = runAgent(request, {
        engine,
        deps: createLocalDeps(),
        approve: async () => 'accepted',
        onEvent: (event) => events.push(event),
        ...extra,
    });
    return { result, events };
}

const resultsSent = (call: Call) => call.messages.filter((m) => m.role === 'user').map((m) => m.content);

beforeAll(async () => {
    setTestDb(await createTestDatabase());
});
afterAll(async () => {
    await closeTestDatabase();
});
beforeEach(async () => {
    await resetTestDatabase();
    await createFolder(FOLDER, 'Home');
    await addNote(GARDEN, 'Garden plan', 'Planting zucchini along the south fence in May.');
});

describe('runAgent', () => {
    it('should answer after search_notes then get_note in 3 steps', async () => {
        const { engine, calls } = scriptedEngine([
            { tool: 'search_notes', args: { query: 'zucchini' } },
            { tool: 'get_note', args: { id: GARDEN } },
            { answer: 'You plant zucchini in May.' },
        ]);
        const { result, events } = run('When do I plant zucchini?', engine);

        expect(await result).toBe('You plant zucchini in May.');
        expect(calls).toHaveLength(3);
        expect(events.filter((e) => e.type === 'step')).toHaveLength(3);
        expect(resultsSent(calls[1]).some((m) => m.includes(GARDEN))).toBe(true);
        expect(resultsSent(calls[2]).some((m) => m.includes('south fence'))).toBe(true);
        // The request is the last message every time.
        for (const call of calls) expect(call.messages.at(-1)).toEqual({ role: 'user', content: 'When do I plant zucchini?' });
    });

    it('should read a long note one part at a time with get_note part (#797)', async () => {
        const LONG = '30000000-0000-0000-0000-000000000002';
        const sections = Array.from({ length: 6 }, (_, s) => `## Section ${s + 1}\n\n${`Point ${s + 1} of the review covers the schedule. `.repeat(20).trim()}`);
        await addNote(LONG, 'Review', sections.join('\n\n'));
        const { engine, calls } = scriptedEngine([
            { tool: 'get_note', args: { id: LONG } },
            { tool: 'get_note', args: { id: LONG, part: 6 } },
            { answer: 'Point 6 is about the schedule.' },
        ]);

        expect(await run('What does the last section say?', engine).result).toBe('Point 6 is about the schedule.');
        const first = resultsSent(calls[1]).join('\n');
        expect(first).toContain('"part":1,"parts":6');
        expect(first).toContain('Section 6 (part 6)');
        expect(first).toContain('Point 1 of');
        expect(first).not.toContain('Point 6 of');
        expect(resultsSent(calls[2]).join('\n')).toContain('Point 6 of');
    });

    it('should feed invalid JSON, an unknown tool and bad args back as errors and go on', async () => {
        const { engine, calls } = scriptedEngine([
            '{not json',
            { tool: 'delete_everything', args: {} },
            { tool: 'get_note', args: { id: 42 } },
            { answer: 'done' },
        ]);
        const { result, events } = run('Help', engine);

        expect(await result).toBe('done');
        expect(events.filter((e) => e.type === 'error')).toHaveLength(3);
        const last = resultsSent(calls[3]).join('\n');
        expect(last).toContain('not valid JSON');
        expect(last).toContain('Unknown tool: delete_everything');
        expect(last).toContain('Invalid args for get_note');
    });

    it('should force one answer-only generate after 6 tool calls, never a 7th call', async () => {
        const searches = Array.from({ length: MAX_TOOL_STEPS }, (_, i) => ({ tool: 'search_notes', args: { query: `q${i}` } }));
        const { engine, calls } = scriptedEngine([...searches, { answer: 'Here you go.' }]);

        expect(await run('List my folders', engine).result).toBe('Here you go.');
        expect(calls).toHaveLength(MAX_TOOL_STEPS + 1);
        expect(calls[MAX_TOOL_STEPS].schema.anyOf).toBeUndefined();
        expect(calls[MAX_TOOL_STEPS].schema).toMatchObject({ required: ['answer'] });
    });

    it('should not run a repeated call again, nudge, and let the model go on', async () => {
        const search = { tool: 'search_notes', args: { query: 'zucchini' } };
        const { engine, calls } = scriptedEngine([search, search, { answer: 'May.' }]);
        const { result, events } = run('When?', engine);

        expect(await result).toBe('May.');
        expect(events.filter((e) => e.type === 'toolCall')).toHaveLength(1);
        expect(events.filter((e) => e.type === 'toolResult')).toHaveLength(1);
        const nudge = resultsSent(calls[2]).find((m) => m.includes('You already called'))!;
        expect(nudge).toContain('You already called search_notes with these arguments (step 1)');
        // The nudge is short: it does not carry the result again.
        expect(nudge).not.toContain('Garden plan');
        expect(calls[2].schema.anyOf).toBeDefined();
    });

    it('should match a repeat whatever the order of the args keys', async () => {
        const { engine, calls } = scriptedEngine([
            { tool: 'search_notes', args: { query: 'zucchini', limit: 3 } },
            { tool: 'search_notes', args: { limit: 3, query: 'zucchini' } },
            { answer: 'ok' },
        ]);
        const { result, events } = run('When?', engine);

        expect(await result).toBe('ok');
        expect(calls).toHaveLength(3);
        expect(events.filter((e) => e.type === 'toolCall')).toHaveLength(1);
    });

    it('should force an answer-only turn after two repeats in a row and end within the cap', async () => {
        const search = { tool: 'search_notes', args: { query: 'zucchini' } };
        const { engine, calls } = scriptedEngine([search, search, search, { answer: 'It is about zucchini.' }]);
        const { result, events } = run('What is this about?', engine);

        expect(await result).toBe('It is about zucchini.');
        expect(calls).toHaveLength(4);
        expect(events.filter((e) => e.type === 'toolCall')).toHaveLength(1);
        expect(calls[3].schema.anyOf).toBeUndefined();
        expect(calls[3].schema).toMatchObject({ required: ['answer'] });
        expect(resultsSent(calls[3]).filter((m) => m.includes('You already called'))).toHaveLength(2);
        expect(events.filter((e) => e.type === 'error')).toHaveLength(0);
    });

    it('should not count a repeat as a step', async () => {
        const search = (query: string) => ({ tool: 'search_notes', args: { query } });
        // Six real steps with a repeat after the first: the repeat does not use one of the six.
        const { engine, calls } = scriptedEngine([search('a'), search('a'), search('b'), search('c'), search('d'), search('e'), search('f'), { answer: 'done' }]);

        expect(await run('Go', engine).result).toBe('done');
        expect(calls).toHaveLength(8);
        expect(calls[7].schema.anyOf).toBeUndefined();
    });

    it('should run the same read again after a write', async () => {
        const search = { tool: 'search_notes', args: { query: 'zucchini' } };
        const append = { tool: 'append_to_note', args: { id: GARDEN, markdown: 'More.' } };
        const { engine } = scriptedEngine([search, append, search, { answer: 'ok' }]);
        const { result, events } = run('Go', engine);

        expect(await result).toBe('ok');
        expect(events.filter((e) => e.type === 'toolCall' && e.tool === 'search_notes')).toHaveLength(2);
    });

    it('should ask approve for a readOnly: false tool and not run it when rejected', async () => {
        const execute = vi.fn();
        const writeTool: AnyJournalTool = {
            name: 'rename_note',
            title: 'Rename note',
            description: 'Rename a note.',
            input: z.object({ id: z.string(), title: z.string() }),
            readOnly: false,
            execute,
        };
        const approve = vi.fn(async () => 'rejected' as const);
        const { engine, calls } = scriptedEngine([
            { tool: 'rename_note', args: { id: GARDEN, title: 'Veg' } },
            { answer: 'Not renamed.' },
        ]);
        const { result, events } = run('Rename it', engine, { approve, tools: [...AGENT_TOOLS, writeTool] });

        expect(await result).toBe('Not renamed.');
        expect(approve).toHaveBeenCalledWith({ tool: 'rename_note', args: { id: GARDEN, title: 'Veg' } });
        expect(execute).not.toHaveBeenCalled();
        expect(events.some((e) => e.type === 'proposal')).toBe(true);
        expect(resultsSent(calls[1]).join('\n')).toContain('rejected by the user');
    });

    describe('rejected edits (#838)', () => {
        const execute = vi.fn();
        const writeTool: AnyJournalTool = {
            name: 'rename_note',
            title: 'Rename note',
            description: 'Rename a note.',
            input: z.object({ id: z.string(), title: z.string() }),
            readOnly: false,
            execute,
        };
        const rename = (title: string) => ({ tool: 'rename_note', args: { id: GARDEN, title } });
        const withWrite = (approve: RunAgentOptions['approve']) => ({ approve, tools: [...AGENT_TOOLS, writeTool] });

        it('should not show the same edit again after a rejection and send a nudge', async () => {
            const approve = vi.fn(async () => 'rejected' as const);
            const { engine, calls } = scriptedEngine([rename('Veg'), rename('Veg'), { answer: 'It is about zucchini.' }]);
            const { result, events } = run('What is this about?', engine, withWrite(approve));

            expect(await result).toBe('It is about zucchini.');
            expect(approve).toHaveBeenCalledTimes(1);
            expect(events.filter((e) => e.type === 'proposal')).toHaveLength(1);
            expect(events.filter((e) => e.type === 'toolCall')).toHaveLength(1);
            expect(resultsSent(calls[2]).join('\n')).toContain('The user rejected this edit at step 1. Do not propose it again.');
            expect(execute).not.toHaveBeenCalled();
        });

        it('should match the rejected edit whatever the order of the args keys', async () => {
            const approve = vi.fn(async () => 'rejected' as const);
            const reordered = { tool: 'rename_note', args: { title: 'Veg', id: GARDEN } };
            const { engine } = scriptedEngine([rename('Veg'), reordered, { answer: 'ok' }]);

            expect(await run('Q', engine, withWrite(approve)).result).toBe('ok');
            expect(approve).toHaveBeenCalledTimes(1);
        });

        it('should keep the repeat history of reads across a rejected write', async () => {
            const search = { tool: 'search_notes', args: { query: 'zucchini' } };
            const approve = vi.fn(async () => 'rejected' as const);
            const { engine } = scriptedEngine([search, rename('Veg'), search, { answer: 'ok' }]);
            const { result, events } = run('Q', engine, withWrite(approve));

            expect(await result).toBe('ok');
            expect(events.filter((e) => e.type === 'toolCall' && e.tool === 'search_notes')).toHaveLength(1);
        });

        it('should force an answer-only turn after two rejections', async () => {
            const approve = vi.fn(async () => 'rejected' as const);
            const { engine, calls } = scriptedEngine([rename('Veg'), rename('Herbs'), { answer: 'Nothing changed.' }]);
            const { result, events } = run('What is this about?', engine, withWrite(approve));

            expect(await result).toBe('Nothing changed.');
            expect(approve).toHaveBeenCalledTimes(2);
            expect(calls).toHaveLength(3);
            expect(calls[2].schema.anyOf).toBeUndefined();
            expect(calls[2].schema).toMatchObject({ required: ['answer'] });
            expect(events.filter((e) => e.type === 'error')).toHaveLength(0);
        });

        it('should end with an answer within the cap when the model keeps proposing the same edit', async () => {
            const approve = vi.fn(async () => 'rejected' as const);
            const { engine, calls } = scriptedEngine([rename('Veg'), rename('Veg'), rename('Veg'), { answer: 'It is about zucchini.' }]);
            const { result, events } = run('What is this about?', engine, withWrite(approve));

            expect(await result).toBe('It is about zucchini.');
            expect(approve).toHaveBeenCalledTimes(1);
            expect(calls).toHaveLength(4);
            expect(calls[3].schema.anyOf).toBeUndefined();
            expect(events.some((e) => e.type === 'error' || e.type === 'failed')).toBe(false);
        });

        it('should still run an accepted edit and clear the read history', async () => {
            const search = { tool: 'search_notes', args: { query: 'zucchini' } };
            const { engine } = scriptedEngine([search, rename('Veg'), search, { answer: 'ok' }]);
            const { result, events } = run('Q', engine, withWrite(async () => 'accepted'));

            expect(await result).toBe('ok');
            expect(events.filter((e) => e.type === 'toolCall' && e.tool === 'search_notes')).toHaveLength(2);
        });
    });

    describe('failed edits (#838)', () => {
        // A plain function, not vi.fn: vitest fails the test on a vi.fn that rejects, even when the loop catches it.
        let runs = 0;
        const execute = async () => {
            runs++;
            throw new Error('"why we are doing this" is not in block 1.');
        };
        const failingEdit = {
            editor: true as const,
            name: 'replace_text',
            title: 'Replace text',
            description: 'Replace text in a block of the open note.',
            input: z.object({ block: z.number(), find: z.string(), replace: z.string() }),
            readOnly: false,
            execute,
        };
        const edit = (find: string) => ({ tool: 'replace_text', args: { block: 1, find, replace: 'x' } });
        const tools = [...AGENT_TOOLS.filter((tool) => tool.name !== 'replace_text'), failingEdit];

        beforeEach(() => (runs = 0));

        it('should not run the same failed edit again and send a nudge', async () => {
            const approve = vi.fn(async () => 'accepted' as const);
            const reordered = { tool: 'replace_text', args: { replace: 'x', find: 'why', block: 1 } };
            const { engine, calls } = scriptedEngine([edit('why'), reordered, { answer: 'It is about zucchini.' }]);
            const { result, events } = run('What is this about?', engine, { approve, tools });

            expect(await result).toBe('It is about zucchini.');
            expect(runs).toBe(1);
            expect(approve).not.toHaveBeenCalled();
            expect(events.filter((e) => e.type === 'error')).toHaveLength(1);
            expect(resultsSent(calls[2]).join('\n')).toContain('That edit failed at step 1. Do not try it again; answer the question.');
        });

        it('should keep the repeat history of reads across a failed edit', async () => {
            const search = { tool: 'search_notes', args: { query: 'zucchini' } };
            const { engine } = scriptedEngine([search, edit('why'), search, { answer: 'ok' }]);
            const { result, events } = run('Q', engine, { tools });

            expect(await result).toBe('ok');
            expect(events.filter((e) => e.type === 'toolCall' && e.tool === 'search_notes')).toHaveLength(1);
        });

        it('should force an answer-only turn after two failed edits', async () => {
            const { engine, calls } = scriptedEngine([edit('why'), edit('how'), { answer: 'Nothing changed.' }]);
            const { result } = run('What is this about?', engine, { tools });

            expect(await result).toBe('Nothing changed.');
            expect(runs).toBe(2);
            expect(calls).toHaveLength(3);
            expect(calls[2].schema.anyOf).toBeUndefined();
            expect(calls[2].schema).toMatchObject({ required: ['answer'] });
        });

        it('should count a failed and a rejected edit together toward the forced answer', async () => {
            const rename = { tool: 'rename_note', args: { id: GARDEN, title: 'Veg' } };
            const writeTool: AnyJournalTool = {
                name: 'rename_note',
                title: 'Rename note',
                description: 'Rename a note.',
                input: z.object({ id: z.string(), title: z.string() }),
                readOnly: false,
                execute: vi.fn(),
            };
            const { engine, calls } = scriptedEngine([edit('why'), rename, { answer: 'Nothing changed.' }]);
            const { result } = run('Q', engine, { approve: async () => 'rejected', tools: [...tools, writeTool] });

            expect(await result).toBe('Nothing changed.');
            expect(calls).toHaveLength(3);
            expect(calls[2].schema.anyOf).toBeUndefined();
        });

        it('should end with an answer within the cap when the model keeps retrying the failed edit', async () => {
            const { engine, calls } = scriptedEngine([edit('why'), edit('why'), edit('why'), { answer: 'It is about zucchini.' }]);
            const { result, events } = run('What is this about?', engine, { tools });

            expect(await result).toBe('It is about zucchini.');
            expect(runs).toBe(1);
            expect(calls).toHaveLength(4);
            expect(calls[3].schema.anyOf).toBeUndefined();
            expect(events.some((e) => e.type === 'failed')).toBe(false);
        });
    });

    it('should stop on abort with no further generate', async () => {
        const controller = new AbortController();
        const { engine, calls } = scriptedEngine([{ tool: 'list_folders', args: {} }, { answer: 'never' }]);
        const generate = engine.generate;
        engine.generate = async (...args) => {
            const output = await generate(...args);
            controller.abort();
            return output;
        };

        expect(await run('Folders?', engine, { signal: controller.signal }).result).toBeNull();
        expect(calls).toHaveLength(1);
    });

    it('should send a schema that lists exactly AGENT_TOOLS plus answer', async () => {
        const { engine, calls } = scriptedEngine([{ answer: 'hi' }]);
        await run('Hi', engine).result;

        const branches = calls[0].schema.anyOf!;
        expect(branches.map((b) => b.properties.tool?.const ?? 'answer')).toEqual([
            ...AGENT_TOOLS.map((t) => t.name),
            'answer',
        ]);
        expect(AGENT_TOOLS.length).toBeLessThanOrEqual(8);
    });

    it('should keep the turn schema under ~850 tokens', () => {
        // Was 600 with 4 notes tools; the 5 editor tools (#701) bring it to about 815.
        expect(estimateTokens(JSON.stringify(turnSchema(AGENT_TOOLS)))).toBeLessThan(850);
    });
});

describe('runAgent — replies that are not JSON (#796)', () => {
    /** A reply cut off at max_tokens: the answer string never closes. */
    const cutOff = `{"answer": "${'This note is about '.repeat(100)}`;

    it('should parse a reply padded with whitespace', async () => {
        const { engine } = scriptedEngine([`\n\n  {"answer":\n\n   "Zucchini."}  ${' '.repeat(300)}\n`]);
        expect(await run('Hi', engine).result).toBe('Zucchini.');
    });

    it('should tell the model to reply with one JSON object after a bad reply, and go on', async () => {
        const { engine, calls } = scriptedEngine([cutOff, { answer: 'A garden plan.' }]);
        expect(await run('what is this about?', engine).result).toBe('A garden plan.');
        expect(resultsSent(calls[1]).join('\n')).toContain('not valid JSON. Reply with one JSON object only.');
    });

    it('should end the run after two bad replies in a row with a plain message', async () => {
        const { engine, calls } = scriptedEngine([cutOff, cutOff, { answer: 'never' }]);
        const { result, events } = run('what is this about?', engine);

        expect(await result).toBeNull();
        expect(calls).toHaveLength(2);
        expect(events.filter((e) => e.type === 'error')).toEqual([
            { type: 'error', error: 'The reply was not valid JSON.' },
            { type: 'error', error: 'The reply was not valid JSON.' },
        ]);
        expect(events.at(-1)).toEqual({ type: 'failed', message: FORMAT_FAILED });
    });

    it('should keep every step of "what is this about?" on a two-page open note inside the context window', async () => {
        // About two pages: 4 headings and 24 paragraphs of ~300 characters.
        const paragraph = 'The project review covered the schedule, the budget and the open risks in detail. '.repeat(4);
        const content = Array.from({ length: 4 }, (_, i) => [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Section ${i + 1}` }] },
            ...Array.from({ length: 6 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: paragraph }] })),
        ]).flat();
        const doc = editorSchema.nodeFromJSON({ type: 'doc', content });
        const editor: ActiveEditorStore = {
            get: () => ({ docId: GARDEN, editor: { state: EditorState.create({ doc }) } as unknown as Editor, editable: true, excludeFromAI: false }),
            subscribe: () => () => {},
        };
        const { engine, calls } = scriptedEngine([
            { tool: 'read_open_note', args: {} },
            { tool: 'get_note', args: { id: GARDEN } },
            { answer: 'A project review.' },
        ]);

        expect(await run(`Open note: "Review" (id: ${GARDEN})\nwhat is this about?`, engine, { editor }).result).toBe('A project review.');
        const schemaTokens = estimateTokens(JSON.stringify(turnSchema(AGENT_TOOLS)));
        // The prompt estimate (characters / 3) of each step, schema included, leaves room for the reply.
        for (const call of calls) expect(estimatePrompt(call.messages) + schemaTokens).toBeLessThanOrEqual(CONTEXT_WINDOW - MAX_TOKENS);
        // The note read in full: no step was trimmed away.
        expect(resultsSent(calls[2]).join('\n')).toContain('Section 4');
    });
});
