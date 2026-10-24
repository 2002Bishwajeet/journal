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
import {
    AGENT_TOOLS,
    MAX_TOOL_STEPS,
    runAgent,
    turnSchema,
    type AgentEngine,
    type AgentEvent,
    type AgentMessage,
    type RunAgentOptions,
} from '@/lib/agent/loop/agentLoop';
import { estimateTokens } from '@/lib/agent/loop/trim';

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
        approve: async () => true,
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
        const search = { tool: 'list_folders', args: {} };
        const { engine, calls } = scriptedEngine([...Array(MAX_TOOL_STEPS).fill(search), { answer: 'Here you go.' }]);

        expect(await run('List my folders', engine).result).toBe('Here you go.');
        expect(calls).toHaveLength(MAX_TOOL_STEPS + 1);
        expect(calls[MAX_TOOL_STEPS].schema.anyOf).toBeUndefined();
        expect(calls[MAX_TOOL_STEPS].schema).toMatchObject({ required: ['answer'] });
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
        const approve = vi.fn(async () => false);
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

    it('should keep the turn schema under ~600 tokens', () => {
        expect(estimateTokens(JSON.stringify(turnSchema(AGENT_TOOLS)))).toBeLessThan(600);
    });
});
