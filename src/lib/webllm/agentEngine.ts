/**
 * `AgentEngine` over WebLLM (#698). Every turn is grammar-constrained to the loop's JSON
 * Schema, at temperature 0, with Qwen3's thinking turned off. Loading the agent model
 * unloads the editor model: one model at a time.
 */
import type * as WebLLMTypes from '@mlc-ai/web-llm';
import type { AgentEngine } from '@/lib/agent/loop/agentLoop';
import { getLoadedEngine, initWebLLM } from './engine';

type CompletionEngine = Pick<WebLLMTypes.MLCEngineInterface, 'chat' | 'interruptGenerate'>;

/** With `enable_thinking: false`, web-llm starts the reply with the empty thinking block it added to the prompt (#796). */
const THINK_BLOCK = /^\s*<think>[\s\S]*?<\/think>\s*/;

/** `load` resolves to an engine with the agent model loaded. */
export function toAgentEngine(load: () => Promise<CompletionEngine>): AgentEngine {
    return {
        async generate(messages, { schema, maxTokens, signal }) {
            const engine = await load();
            const interrupt = () => engine.interruptGenerate();
            signal?.addEventListener('abort', interrupt, { once: true });
            try {
                const response = await engine.chat.completions.create({
                    messages,
                    response_format: { type: 'json_object', schema: JSON.stringify(schema) },
                    max_tokens: maxTokens,
                    temperature: 0,
                    extra_body: { enable_thinking: false },
                });
                return (response.choices[0]?.message?.content ?? '').replace(THINK_BLOCK, '');
            } finally {
                signal?.removeEventListener('abort', interrupt);
            }
        },
    };
}

export function createAgentEngine(
    agentModelId: string,
    onProgress?: (progress: WebLLMTypes.InitProgressReport) => void
): AgentEngine {
    return toAgentEngine(async () => {
        const engine = (await initWebLLM(onProgress, agentModelId)) ? getLoadedEngine() : null;
        if (!engine) throw new Error("Couldn't load the assistant model.");
        return engine;
    });
}
