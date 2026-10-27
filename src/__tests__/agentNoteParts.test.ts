/**
 * A long note in parts (#797): split at headings and blocks inside the prompt budget, read a
 * part at a time, and summarized part by part with one last call to combine.
 */
import { describe, it, expect, vi } from 'vitest';
import { ANSWER_SCHEMA, FORMAT_FAILED, MAX_TOKENS, type AgentEngine, type AgentEvent, type AgentMessage } from '@/lib/agent/loop/agentLoop';
import { NOTE_PART_TOKENS, notePart, openNoteContext, outline, splitNote } from '@/lib/agent/loop/noteParts';
import { isWholeNoteAsk, summarizeNote } from '@/lib/agent/loop/summarizeNote';
import { estimatePrompt, estimateTokens, promptBudget } from '@/lib/agent/loop/trim';

/** `sections` headings, each with `paragraphs` paragraphs of ~250 characters naming the section. */
function longNote(sections: number, paragraphs: number): string {
    return Array.from({ length: sections }, (_, s) => [
        `## Section ${s + 1}`,
        ...Array.from({ length: paragraphs }, (_, p) => `Point ${s + 1}.${p + 1}: the review covered the schedule, the budget and the open risks. `.repeat(3).trim()),
    ]).flat().join('\n\n');
}

describe('splitNote', () => {
    it('should split a long note at headings, with every part inside the budget', () => {
        // 6 sections of ~1,000 characters: two whole sections do not fit in one 1,500-character part.
        const parts = splitNote(longNote(6, 4), NOTE_PART_TOKENS);

        expect(parts).toHaveLength(6);
        parts.forEach((part, i) => {
            expect(estimateTokens(part)).toBeLessThanOrEqual(NOTE_PART_TOKENS);
            expect(part.startsWith(`## Section ${i + 1}\n\n`)).toBe(true);
        });
    });

    it('should split a section longer than a part between its blocks', () => {
        const markdown = longNote(1, 20);
        const parts = splitNote(markdown, NOTE_PART_TOKENS);

        expect(parts.length).toBeGreaterThan(1);
        for (const part of parts) expect(estimateTokens(part)).toBeLessThanOrEqual(NOTE_PART_TOKENS);
        // Every paragraph is whole in one part, and none is lost.
        expect(parts.join('\n\n')).toBe(markdown);
    });

    it('should cut one block longer than a part at sentence ends', () => {
        const paragraph = 'This sentence is about the garden. '.repeat(200).trim();
        const parts = splitNote(paragraph, NOTE_PART_TOKENS);

        expect(parts.length).toBeGreaterThan(1);
        for (const part of parts) {
            expect(estimateTokens(part)).toBeLessThanOrEqual(NOTE_PART_TOKENS);
            expect(part.endsWith('garden.')).toBe(true);
        }
    });

    it('should keep a fenced code block with blank lines in one block', () => {
        const code = '```\nconst a = 1;\n\nconst b = 2;\n```';
        expect(splitNote(`Intro\n\n${code}\n\nOutro`, 13)).toEqual(['Intro', code, 'Outro']);
    });

    it('should give one empty part for an empty note', () => {
        expect(splitNote('', NOTE_PART_TOKENS)).toEqual(['']);
    });
});

describe('notePart and the open note context', () => {
    const note = { id: 'n1', title: 'Review', markdown: longNote(6, 4) };

    it('should give one part with the part count and the outline', () => {
        const third = notePart(note, 3);
        expect(third).toMatchObject({ id: 'n1', title: 'Review', part: 3, parts: 6 });
        expect(third.markdown).toContain('Point 3.1');
        expect(third.markdown).not.toContain('Point 2.');
        expect(third.outline).toEqual(Array.from({ length: 6 }, (_, i) => `Section ${i + 1} (part ${i + 1})`));
    });

    it('should refuse a part past the last one', () => {
        expect(() => notePart(note, 7)).toThrow('The note has 6 parts; there is no part 7.');
    });

    it('should cut a long outline', () => {
        const headings = outline(Array.from({ length: 30 }, (_, i) => `# H${i}`));
        expect(headings).toHaveLength(21);
        expect(headings.at(-1)).toBe('…');
    });

    it('should name the part count and outline, not the body, in the first-turn context', () => {
        const context = openNoteContext(notePart(note, 1));
        expect(context).toBe(`Open note: "Review" (id: n1), 6 parts. Outline: ${notePart(note, 1).outline.join('; ')}\n`);
        expect(context).not.toContain('Point 1.1');
        expect(openNoteContext(notePart({ id: 'n2', title: 'Short', markdown: 'Hi.' }, 1))).toBe('Open note: "Short" (id: n2), 1 part\n');
    });
});

describe('isWholeNoteAsk', () => {
    it.each(['Summarize the open note', 'summarize', 'Summarise this note.', 'what is this about?', "What's this note about"])('should match "%s"', (ask) => {
        expect(isWholeNoteAsk(ask)).toBe(true);
    });

    it.each(['summarize my trip notes', 'what is the budget?', 'what is this about the budget?'])('should not match "%s"', (ask) => {
        expect(isWholeNoteAsk(ask)).toBe(false);
    });
});

describe('summarizeNote', () => {
    // About 12,000 characters per section: each section is a part of the summary.
    const note = { title: 'Review', markdown: longNote(5, 45) };

    /** Answers each part with the section it was given, and the combine call with `final`. */
    function fakeEngine(final = { answer: 'The whole review.' }) {
        const calls: { messages: AgentMessage[]; maxTokens: number; schema: object }[] = [];
        const engine: AgentEngine = {
            generate: vi.fn(async (messages, { schema, maxTokens }) => {
                calls.push({ messages, schema, maxTokens });
                const section = messages[1].content.match(/## (Section \d+)/)?.[1];
                return JSON.stringify(section ? { answer: `${section} covers the risks.` } : final);
            }),
        };
        return { engine, calls };
    }

    it('should call the engine once per part, then once to combine the summaries', async () => {
        const { engine, calls } = fakeEngine();
        const events: AgentEvent[] = [];

        const answer = await summarizeNote(note, 'what is this about?', { engine, onEvent: (e) => events.push(e) });

        expect(answer).toBe('The whole review.');
        expect(calls).toHaveLength(6);
        // Every call fits the window with its reply and schema.
        for (const call of calls) {
            expect(call.schema).toBe(ANSWER_SCHEMA);
            expect(estimatePrompt(call.messages)).toBeLessThanOrEqual(promptBudget(call.schema, call.maxTokens));
        }
        expect(calls[4].messages[1].content).toContain('Part 5 of 5');
        const combine = calls[5].messages[1].content;
        expect(combine).toContain('Part 1: Section 1 covers the risks.');
        expect(combine).toContain('Part 5: Section 5 covers the risks.');
        expect(combine.endsWith('what is this about?')).toBe(true);
        expect(events).toEqual([
            ...Array.from({ length: 5 }, (_, i) => ({ type: 'progress', message: `Reading part ${i + 1} of 5` })),
            { type: 'answer', answer: 'The whole review.' },
        ]);
    });

    it('should combine the summaries of a very long note in rounds, with every prompt inside the budget', async () => {
        // 60 parts (~720,000 characters), each summary as long as a part reply may be.
        const calls: { messages: AgentMessage[]; maxTokens: number }[] = [];
        const engine: AgentEngine = {
            generate: vi.fn(async (messages, { maxTokens }) => {
                calls.push({ messages, maxTokens });
                if (maxTokens === MAX_TOKENS) return JSON.stringify({ answer: 'The whole review.' });
                const section = messages[1].content.match(/## (Section \d+)/)?.[1] ?? 'A group';
                return JSON.stringify({ answer: `${section} covers the risks. `.padEnd(600, 'x') });
            }),
        };
        const events: AgentEvent[] = [];

        const answer = await summarizeNote({ title: 'Review', markdown: longNote(60, 45) }, 'summarize', { engine, onEvent: (e) => events.push(e) });

        expect(answer).toBe('The whole review.');
        expect(calls.filter((c) => c.messages[0].content.startsWith('You summarize one part'))).toHaveLength(60);
        // More than one combine call, and only the last one gives the answer.
        expect(calls.length).toBeGreaterThan(61);
        expect(calls.filter((c) => c.maxTokens === MAX_TOKENS)).toEqual([calls.at(-1)]);
        for (const call of calls) expect(estimatePrompt(call.messages)).toBeLessThanOrEqual(promptBudget(ANSWER_SCHEMA, call.maxTokens));
        expect(events).toContainEqual({ type: 'progress', message: 'Combining the part summaries' });
    });

    it('should answer with the one summary when the note is a single part', async () => {
        const { engine, calls } = fakeEngine();
        expect(await summarizeNote({ title: 'Review', markdown: longNote(1, 4) }, 'summarize', { engine })).toBe('Section 1 covers the risks.');
        expect(calls).toHaveLength(1);
    });

    it('should stop on abort with no further call', async () => {
        const controller = new AbortController();
        const { engine, calls } = fakeEngine();
        const generate = engine.generate;
        engine.generate = async (...args) => {
            const output = await generate(...args);
            if (calls.length === 2) controller.abort();
            return output;
        };

        expect(await summarizeNote(note, 'summarize', { engine, signal: controller.signal })).toBeNull();
        expect(calls).toHaveLength(2);
    });

    it('should end with the format message when a reply is not an answer', async () => {
        const engine: AgentEngine = { generate: vi.fn(async () => '{"answer": "cut off') };
        const events: AgentEvent[] = [];

        expect(await summarizeNote(note, 'summarize', { engine, onEvent: (e) => events.push(e) })).toBeNull();
        expect(engine.generate).toHaveBeenCalledTimes(1);
        expect(events.at(-1)).toEqual({ type: 'failed', message: FORMAT_FAILED });
    });
});
