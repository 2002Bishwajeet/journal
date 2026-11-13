/**
 * Apple's on-device model (#1266): Foundation Models through the native plugin `journal-apple-ai`
 * (native/rust/apple_ai.rs) in the iOS app, on Apple Intelligence devices with iOS or iPadOS 26.
 * Nothing downloads, and it runs outside the web view's memory. `engine.ts` loads it like a
 * web-llm model for the editor jobs and `chat`; the assistant stays on WebLLM, because its
 * prompts and tool calls need more than the model's 4,096-token window.
 */
import { invokeNative } from '@/lib/native';
import type { ChatMessage } from './engine';

const PLUGIN = 'journal-apple-ai';

let available = false;

/** Asks the native app whether the model can run now. False on the web and without the plugin. */
export async function checkAppleModel(): Promise<boolean> {
    const answer = await invokeNative<{ available: boolean }>(PLUGIN, 'available').catch(() => undefined);
    available = answer?.available === true;
    return available;
}

/** The last `checkAppleModel` answer: false until it has run. */
export const isAppleModelAvailable = (): boolean => available;

interface CompletionRequest {
    messages: ChatMessage[];
    max_tokens?: number;
    temperature?: number;
    /** A JSON Schema string: the plugin then uses guided generation. */
    response_format?: { schema?: string };
}

/** The part of web-llm's engine that the editor jobs and `chat` call, over the plugin's `generate`. */
export const appleEngine = {
    chat: {
        completions: {
            async create({ messages, max_tokens, temperature, response_format }: CompletionRequest) {
                const instructions = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
                const turns = messages.filter((m) => m.role !== 'system');
                const prompt = turns.length === 1
                    ? turns[0].content
                    : turns.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n');
                const answer = await invokeNative<{ text: string }>(PLUGIN, 'generate', {
                    instructions: instructions || undefined,
                    prompt,
                    maxTokens: max_tokens,
                    temperature,
                    schema: response_format?.schema,
                });
                return { choices: [{ message: { content: answer?.text ?? '' } }] };
            },
        },
    },
};
