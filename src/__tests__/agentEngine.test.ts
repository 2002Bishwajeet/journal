/**
 * The WebLLM agent adapter and one-model-at-a-time (#698), over fake engines: no WebLLM runs.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createAgentEngine, toAgentEngine } from '@/lib/webllm/agentEngine';
import { checkGrammar, initWebLLM, isWebLLMReady, rewriteText } from '@/lib/webllm/engine';
import { DEFAULT_AGENT_MODEL_ID, DEFAULT_MODEL_ID, getModelInfo } from '@/lib/webllm/models';

const create = vi.hoisted(() => vi.fn(async () => ({ choices: [{ message: { content: '["an error"]' } }] })));
const reload = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@mlc-ai/web-llm', () => ({
    WebWorkerMLCEngine: class {
        chat = { completions: { create } };
        reload = reload;
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

    it('should drop the empty thinking block web-llm puts before the JSON (#796)', async () => {
        const content = '<think>\n\n</think>\n\n{"answer":"hi"}';
        const fake = {
            chat: { completions: { create: vi.fn(async () => ({ choices: [{ message: { content } }] })) } },
            interruptGenerate: vi.fn(),
        };
        const output = await toAgentEngine(async () => fake as never).generate([], { schema: {}, maxTokens: 512 });
        expect(JSON.parse(output)).toEqual({ answer: 'hi' });
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

describe('createAgentEngine', () => {
    it('should say a load that ran out of GPU memory needs a smaller model (#1023)', async () => {
        reload.mockRejectedValueOnce(new Error('The WebGPU device was lost while loading the model. This issue often occurs due to running out of memory (OOM).'));
        const engine = createAgentEngine('Qwen3.5-2B-q4f16_1-MLC');
        await expect(engine.generate([], { schema: {}, maxTokens: 1 })).rejects.toMatchObject({
            name: 'ModelLoadError',
            message: 'Not enough memory for this model. Try Qwen3 1.7B.',
        });
    });

    it('should load a model with its catalogue context window and give the loop that window (#1025)', async () => {
        const model = getModelInfo('Qwen3.5-4B-q4f16_1-MLC')!;
        model.contextWindow = 8192;
        try {
            const engine = createAgentEngine(model.id);
            expect(engine.contextWindow).toBe(8192);
            await engine.generate([], { schema: {}, maxTokens: 1 });
            expect(reload).toHaveBeenLastCalledWith(model.id, { context_window_size: 8192 });
        } finally {
            delete model.contextWindow;
        }
        // Without one, the prebuilt 4,096 window: no chat options.
        const engine = createAgentEngine(DEFAULT_AGENT_MODEL_ID);
        expect(engine.contextWindow).toBeUndefined();
        await engine.generate([], { schema: {}, maxTokens: 1 });
        expect(reload).toHaveBeenLastCalledWith(DEFAULT_AGENT_MODEL_ID, undefined);
    });

    it('should keep the generic message for other load failures', async () => {
        reload.mockRejectedValueOnce(new Error('Failed to fetch'));
        await expect(createAgentEngine('Qwen3-4B-q4f16_1-MLC').generate([], { schema: {}, maxTokens: 1 })).rejects.toThrow("Couldn't load the assistant model.");
    });
});
