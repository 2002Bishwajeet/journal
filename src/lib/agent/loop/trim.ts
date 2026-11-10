/**
 * Keeps an agent prompt inside the model's context window (#698). The worker API has no
 * tokenizer, so tokens are estimated as characters / 3, which overcounts for English.
 */

export interface AgentMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/** Every prebuilt WebLLM model has a 4,096-token context window. */
export const CONTEXT_WINDOW = 4096;
/** Room for the chat template's tokens around each message. */
const MESSAGE_OVERHEAD = 4;
/** What an older tool result is cut to before whole steps are dropped. */
const SHORT_RESULT = 200;

export const estimateTokens = (text: string) => Math.ceil(text.length / 3);

export const estimatePrompt = (messages: AgentMessage[]) =>
    messages.reduce((sum, m) => sum + estimateTokens(m.content) + MESSAGE_OVERHEAD, 0);

const shorten = (text: string) => (text.length > SHORT_RESULT ? `${text.slice(0, SHORT_RESULT)}… (shortened)` : text);

/**
 * `messages` is the system prompt, the request, then one (assistant call, user result) pair per
 * step, in chat order (#1024). The system prompt, the request and the last two steps are always
 * kept whole; older results are shortened first, then the oldest steps are dropped.
 */
export function trimToBudget(messages: AgentMessage[], budget: number): AgentMessage[] {
    const [system, request] = messages;
    const steps: AgentMessage[][] = [];
    for (let i = 2; i < messages.length; i += 2) steps.push(messages.slice(i, i + 2));

    const build = () => [system, request, ...steps.flat()];
    const over = () => estimatePrompt(build()) > budget;

    for (let i = 0; i < steps.length - 2 && over(); i++) {
        const [call, result] = steps[i];
        steps[i] = [call, { ...result, content: shorten(result.content) }];
    }
    while (steps.length > 2 && over()) steps.shift();
    return build();
}
