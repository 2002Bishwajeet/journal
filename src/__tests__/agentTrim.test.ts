/**
 * trimToBudget (#698): an agent prompt always fits the 4k window by the chars / 3 estimate.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS, MAX_TOKENS, formatToolResult, turnSchema } from '@/lib/agent/loop/agentLoop';
import { CONTEXT_WINDOW, estimatePrompt, estimateTokens, trimToBudget, type AgentMessage } from '@/lib/agent/loop/trim';

const budget = CONTEXT_WINDOW - MAX_TOKENS - estimateTokens(JSON.stringify(turnSchema(AGENT_TOOLS)));
const system: AgentMessage = { role: 'system', content: 'You are the assistant in Journal.' };
const request: AgentMessage = { role: 'user', content: 'Summarise my garden notes.' };

function history(steps: number): AgentMessage[] {
    return Array.from({ length: steps }, (_, i) => {
        const markdown = `Note ${i}. `.repeat(2000).slice(0, 10_000);
        const result = formatToolResult('get_note', { data: { id: `note-${i}`, title: `Note ${i}`, markdown } });
        return [
            { role: 'assistant' as const, content: JSON.stringify({ tool: 'get_note', args: { id: `note-${i}` } }) },
            { role: 'user' as const, content: `Result of get_note: ${result}` },
        ];
    }).flat();
}

describe('trimToBudget', () => {
    it('should cut a 10 KB note to 1,500 characters with its length', () => {
        const [, result] = history(1);
        expect(result.content).toContain('… (truncated, 10000 characters)');
        expect(result.content.length).toBeLessThan(1700);
    });

    it('should keep every prompt of a 20-step history under budget with the system prompt and request', () => {
        const steps = history(20);
        for (let n = 1; n <= 20; n++) {
            const messages = [system, ...steps.slice(0, n * 2), request];
            const trimmed = trimToBudget(messages, budget);

            expect(estimatePrompt(trimmed)).toBeLessThanOrEqual(budget);
            expect(trimmed[0]).toEqual(system);
            expect(trimmed.at(-1)).toEqual(request);
            // The last two tool results stay whole.
            expect(trimmed.slice(-5, -1)).toEqual(messages.slice(-5, -1));
        }
    });

    it('should leave a prompt that fits untouched', () => {
        const messages = [system, ...history(1), request];
        expect(trimToBudget(messages, budget)).toEqual(messages);
    });

    it('should shorten older results before dropping steps', () => {
        const messages = [system, ...history(8), request];
        const trimmed = trimToBudget(messages, budget);
        expect(trimmed).toHaveLength(messages.length);
        expect(trimmed[2].content).toContain('… (shortened)');
    });
});
