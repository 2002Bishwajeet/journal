/**
 * The WebLLM agent adapter and one-model-at-a-time (#698), over fake engines: no WebLLM runs.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { toAgentEngine } from '@/lib/webllm/agentEngine';
import { checkGrammar, initWebLLM, isWebLLMReady, rewriteText } from '@/lib/webllm/engine';
import { DEFAULT_AGENT_MODEL_ID, DEFAULT_MODEL_ID } from '@/lib/webllm/models';

const create = vi.hoisted(() => vi.fn(async () => ({ choices: [{ message: { content: '["an error"]' } }] })));

vi.mock('@mlc-ai/web-llm', () => ({
    WebWorkerMLCEngine: class {
        chat = { completions: { create } };
        reload = vi.fn(async () => {});
        unload = vi.fn(async () => {});
        setInitProgressCallback = vi.fn();
    },
}));
vi.mock('@/lib/webllm/requirements', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/webllm/requirements')>()),
    resolveModelId: async (id: string) => id,
}));

beforeAll(() => {
    vi.stubGlobal('Worker', class { terminate() {} });
});

describe('toAgentEngine', () => {
    it('should force the schema as JSON with thinking off and return the content', async () => {
        const fake = {
            chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { content: '{"answer":"hi"}' } }] })) } },
            interruptGenerate: vi.fn(),
        };
        const schema = { anyOf: [{ type: 'object' }] };
        const messages = [{ role: 'user' as const, content: 'Hi' }];

        const output = await toAgentEngine(async () => fake as never).generate(messages, { schema, maxTokens: 512 });

        expect(output).toBe('{"answer":"hi"}');
        expect(fake.chat.completions.create).toHaveBeenCalledWith({
            messages,
            response_format: { type: 'json_object', schema: JSON.stringify(schema) },
            max_tokens: 512,
            temperature: 0,
            extra_body: { enable_thinking: false },
        });
    });

    it('should interrupt the generation on abort', async () => {
        const controller = new AbortController();
        const fake = {
            chat: {
                completions: {
                    create: vi.fn(async () => {
                        controller.abort();
                        return { choices: [{ message: { content: '' } }] };
                    }),
                },
            },
            interruptGenerate: vi.fn(),
        };
        await toAgentEngine(async () => fake as never).generate([], { schema: {}, maxTokens: 1, signal: controller.signal });
        expect(fake.interruptGenerate).toHaveBeenCalledOnce();
    });
});

describe('one model at a time', () => {
    it('should report the editor AI not ready while an agent model is loaded', async () => {
        expect(await initWebLLM(undefined, DEFAULT_AGENT_MODEL_ID)).toBe(true);
        create.mockClear();

        expect(isWebLLMReady()).toBe(false);
        expect(await checkGrammar('Their is a error.')).toEqual([]);
        expect(await rewriteText('draft', 'concise')).toBe('draft');
        expect(create).not.toHaveBeenCalled();

        expect(await initWebLLM(undefined, DEFAULT_MODEL_ID)).toBe(true);
        expect(isWebLLMReady()).toBe(true);
        expect(await checkGrammar('Their is a error.')).toEqual(['an error']);
    });
});
