/**
 * A whole-note ask on a long note, answered in steps (#797). The host, not the model, splits the
 * note into parts that fit the prompt budget, asks for a short summary of each part (one model
 * call per part), then combines the summaries in one last call. When the summaries of a very long
 * note do not fit that last prompt, they are first combined in groups that fit, in rounds.
 */
import { ANSWER_SCHEMA, FORMAT_FAILED, MAX_TOKENS, type AgentEngine, type AgentEvent } from './agentLoop';
import { splitNote } from './noteParts';
import { estimatePrompt, promptBudget, type AgentMessage } from './trim';

/** The reply to one part: 1 to 3 sentences. */
const PART_TOKENS = 200;

const PART_SYSTEM: AgentMessage = {
    role: 'system',
    content: 'You summarize one part of a longer note in 1 to 3 sentences. Keep names, numbers and decisions. Reply with {"answer": "<summary>"}.',
};
const COMBINE_SYSTEM: AgentMessage = {
    role: 'system',
    content:
        "You answer the user's question about a note from summaries of its parts, in order. Cover its start, middle and end. " +
        'Keep the answer short and plain. Reply with {"answer": "<text>"}.',
};

/** The ask for one group of summaries in a round before the last call. */
const GROUP_REQUEST = 'Summarize these parts in 1 to 3 sentences.';

const partHeader = (title: string, part: number, parts: number) => `Part ${part} of ${parts} of the note "${title}":\n\n`;

/** "Summarize", "summarize this note", "what is this about?", and the /summarize request. */
const WHOLE_NOTE_ASK = /^(?:summari[sz]e(?: (?:it|this|this note|the(?: open)? note))?|what(?:['’]s| is) (?:it|this|this note|the(?: open)? note) about)[\s.?!]*$/i;

export const isWholeNoteAsk = (request: string) => WHOLE_NOTE_ASK.test(request.trim());

export interface SummarizeOptions {
    engine: AgentEngine;
    signal?: AbortSignal;
    onEvent?(event: AgentEvent): void;
}

/** Answers `request` about the whole note. Resolves to null when aborted or when a reply is not an answer. */
export async function summarizeNote(
    note: { title: string; markdown: string },
    request: string,
    { engine, signal, onEvent = () => {} }: SummarizeOptions
): Promise<string | null> {
    /** One answer-only call. Null when aborted, or when the reply is not an answer (reported). */
    const ask = async (messages: AgentMessage[], maxTokens: number) => {
        if (signal?.aborted) return null;
        const output = await engine.generate(messages, { schema: ANSWER_SCHEMA, maxTokens, signal });
        if (signal?.aborted) return null;
        try {
            const { answer } = JSON.parse(output);
            if (typeof answer === 'string') return answer;
        } catch {
            // Reported below.
        }
        onEvent({ type: 'failed', message: FORMAT_FAILED });
        return null;
    };

    // The header is sized for 3-digit part numbers, so it fits whatever the count turns out to be.
    const overhead = estimatePrompt([PART_SYSTEM, { role: 'user', content: partHeader(note.title, 100, 100) }]);
    const parts = splitNote(note.markdown, promptBudget(ANSWER_SCHEMA, PART_TOKENS) - overhead);
    const summaries: string[] = [];
    for (const [i, text] of parts.entries()) {
        if (signal?.aborted) return null;
        onEvent({ type: 'progress', message: `Reading part ${i + 1} of ${parts.length}` });
        const summary = await ask([PART_SYSTEM, { role: 'user', content: partHeader(note.title, i + 1, parts.length) + text }], PART_TOKENS);
        if (summary === null) return null;
        summaries.push(summary);
    }
    const combine = (group: string[], question: string): AgentMessage[] => [
        COMBINE_SYSTEM,
        { role: 'user', content: `Summaries of the ${group.length} parts of the note "${note.title}":\n${group.map((s, i) => `Part ${i + 1}: ${s}`).join('\n')}\n\n${question}` },
    ];
    // Each round at least halves the count, since a group always takes two summaries.
    const groupBudget = promptBudget(ANSWER_SCHEMA, PART_TOKENS);
    let round = summaries;
    while (round.length > 1 && estimatePrompt(combine(round, request)) > promptBudget(ANSWER_SCHEMA, MAX_TOKENS)) {
        const groups: string[][] = [];
        for (const summary of round) {
            const group = groups.at(-1);
            if (group && (group.length < 2 || estimatePrompt(combine([...group, summary], GROUP_REQUEST)) <= groupBudget)) group.push(summary);
            else groups.push([summary]);
        }
        const next: string[] = [];
        for (const group of groups) {
            if (group.length > 1) onEvent({ type: 'progress', message: 'Combining the part summaries' });
            const summary = group.length === 1 ? group[0] : await ask(combine(group, GROUP_REQUEST), PART_TOKENS);
            if (summary === null) return null;
            next.push(summary);
        }
        round = next;
    }
    const answer = round.length === 1 ? round[0] : await ask(combine(round, request), MAX_TOKENS);
    if (answer !== null) onEvent({ type: 'answer', answer });
    return answer;
}
