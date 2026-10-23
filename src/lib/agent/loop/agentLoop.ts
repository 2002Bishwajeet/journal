/**
 * The local AI agent loop (#698): drives a small model through registry tool calls to an
 * answer. Pure TypeScript with an injected engine, so it runs the same under a fake in
 * tests and under WebLLM (`@/lib/webllm/agentEngine`) in the app.
 *
 * Every model turn is forced by a JSON Schema to be one tool call or an answer, so a
 * 4,096-token model never has to produce free-form function-call syntax.
 */
import type { ReadDeps } from '@/lib/agent/tools/read';
import type { WriteDeps } from '@/lib/agent/tools/write';
import { TOOLS, toJsonSchema, type AnyJournalTool, type ToolOutput } from '@/lib/agent/tools/registry';
import { CONTEXT_WINDOW, estimateTokens, trimToBudget, type AgentMessage } from './trim';

export type { AgentMessage } from './trim';

export interface AgentEngine {
    generate(messages: AgentMessage[], options: { schema: object; maxTokens: number; signal?: AbortSignal }): Promise<string>;
}

export interface AgentProposal {
    tool: string;
    args: unknown;
}

export type AgentEvent =
    | { type: 'step'; step: number }
    | { type: 'toolCall'; tool: string; args: unknown }
    | { type: 'toolResult'; tool: string; result: string }
    | { type: 'proposal'; proposal: AgentProposal }
    | { type: 'answer'; answer: string }
    | { type: 'error'; error: string };

export interface RunAgentOptions {
    engine: AgentEngine;
    deps: ReadDeps;
    /** Asked before any `readOnly: false` tool; the loop never runs one itself. */
    approve(proposal: AgentProposal): Promise<boolean>;
    signal?: AbortSignal;
    onEvent?(event: AgentEvent): void;
    tools?: AnyJournalTool[];
}

const AGENT_TOOL_NAMES = ['search_notes', 'get_note', 'list_notes', 'list_folders'];
/** At most 8 (#698): each tool adds to the schema and the system prompt. */
export const AGENT_TOOLS = AGENT_TOOL_NAMES.map((name) => TOOLS.find((tool) => tool.name === name)!);

export const MAX_TOOL_STEPS = 6;
export const MAX_TOKENS = 512;
const SEARCH_LIMIT = 5;
const LIST_LIMIT = 20;
const NOTE_LENGTH = 1500;

const ANSWER_SCHEMA = {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
    additionalProperties: false,
};

function argsSchema(tool: AnyJournalTool): object {
    const schema = { ...toJsonSchema(tool) };
    delete schema.$schema;
    return schema;
}

/** One `anyOf` branch per tool, plus the answer. */
export function turnSchema(tools: AnyJournalTool[]): object {
    return {
        anyOf: [
            ...tools.map((tool) => ({
                type: 'object',
                properties: { tool: { const: tool.name }, args: argsSchema(tool) },
                required: ['tool', 'args'],
                additionalProperties: false,
            })),
            ANSWER_SCHEMA,
        ],
    };
}

const firstSentence = (text: string) => text.split(/(?<=\.)\s/)[0];

function systemPrompt(tools: AnyJournalTool[]): string {
    return [
        "You are the assistant in Journal, a notes app. You answer questions about the user's notes using tools.",
        'Tools:',
        ...tools.map((tool) => `- ${tool.name}: ${firstSentence(tool.description)}`),
        'Rules:',
        '- Reply with one JSON object: {"tool": "<name>", "args": {...}} to call a tool, or {"answer": "<text>"} to reply.',
        '- Use note ids from earlier results. Never invent an id.',
        '- Answer as soon as you know enough. Keep the answer short and plain.',
    ].join('\n');
}

function capArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
    const cap = (limit: number) => ({ ...args, limit: Math.min(Number(args.limit ?? limit), limit) });
    if (name === 'search_notes') return cap(SEARCH_LIMIT);
    if (name === 'list_notes') return cap(LIST_LIMIT);
    return args;
}

/** A tool's output as the model sees it: get_note's markdown is cut to 1,500 characters. */
export function formatToolResult(name: string, output: ToolOutput): string {
    let data = output.data;
    if (name === 'get_note' && data && typeof data === 'object' && 'markdown' in data && typeof data.markdown === 'string') {
        const { markdown } = data;
        if (markdown.length > NOTE_LENGTH) {
            data = { ...data, markdown: `${markdown.slice(0, NOTE_LENGTH)}… (truncated, ${markdown.length} characters)` };
        }
    }
    const text = output.text && typeof data === 'string' ? data : JSON.stringify(data);
    return [text, ...(output.notes ?? [])].join('\n');
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Runs one request to an answer. Resolves to null when aborted or when no answer came. */
export async function runAgent(request: string, options: RunAgentOptions): Promise<string | null> {
    const { engine, deps, approve, signal, onEvent = () => {}, tools = AGENT_TOOLS } = options;
    const system: AgentMessage = { role: 'system', content: systemPrompt(tools) };
    const user: AgentMessage = { role: 'user', content: request };
    const history: AgentMessage[] = [];

    const generate = async (schema: object) => {
        const budget = CONTEXT_WINDOW - MAX_TOKENS - estimateTokens(JSON.stringify(schema));
        const messages = trimToBudget([system, ...history, user], budget);
        return engine.generate(messages, { schema, maxTokens: MAX_TOKENS, signal });
    };

    const fail = (output: string, error: string) => {
        onEvent({ type: 'error', error });
        history.push({ role: 'assistant', content: output }, { role: 'user', content: `Error: ${error}` });
    };

    const schema = turnSchema(tools);
    for (let step = 1; step <= MAX_TOOL_STEPS; step++) {
        if (signal?.aborted) return null;
        onEvent({ type: 'step', step });
        const output = await generate(schema);
        if (signal?.aborted) return null;

        let turn: { tool?: unknown; args?: unknown; answer?: unknown };
        try {
            turn = JSON.parse(output);
        } catch {
            fail(output, 'The reply was not valid JSON.');
            continue;
        }
        if (typeof turn?.answer === 'string') {
            onEvent({ type: 'answer', answer: turn.answer });
            return turn.answer;
        }
        const tool = tools.find((t) => t.name === turn?.tool);
        if (!tool) {
            fail(output, `Unknown tool: ${String(turn?.tool)}. Use one of ${tools.map((t) => t.name).join(', ')}.`);
            continue;
        }
        const parsed = tool.input.safeParse(turn.args ?? {});
        if (!parsed.success) {
            fail(output, `Invalid args for ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')}`);
            continue;
        }

        const args = capArgs(tool.name, parsed.data);
        onEvent({ type: 'toolCall', tool: tool.name, args });
        let result: string;
        if (tool.readOnly) {
            try {
                // Only read-only tools run here, and they use only the ReadDeps half.
                result = formatToolResult(tool.name, await tool.execute(deps as WriteDeps, args));
            } catch (error) {
                fail(output, errorMessage(error));
                continue;
            }
        } else {
            const proposal = { tool: tool.name, args };
            onEvent({ type: 'proposal', proposal });
            result = (await approve(proposal)) ? 'accepted' : 'rejected by the user';
            if (signal?.aborted) return null;
        }
        onEvent({ type: 'toolResult', tool: tool.name, result });
        history.push({ role: 'assistant', content: output }, { role: 'user', content: `Result of ${tool.name}: ${result}` });
    }

    if (signal?.aborted) return null;
    onEvent({ type: 'step', step: MAX_TOOL_STEPS + 1 });
    const output = await generate(ANSWER_SCHEMA);
    if (signal?.aborted) return null;
    try {
        const { answer } = JSON.parse(output);
        if (typeof answer === 'string') {
            onEvent({ type: 'answer', answer });
            return answer;
        }
    } catch {
        // Reported below.
    }
    onEvent({ type: 'error', error: 'No answer after the step limit.' });
    return null;
}
