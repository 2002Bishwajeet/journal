// @vitest-environment happy-dom
/**
 * #701: an edit the in-app agent proposes shows in the note as a preview and changes nothing
 * until Accept. Accept builds it again against the note as it is then and applies it as one
 * undo step; Reject, closing the note and switching tabs leave the note as it was.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createTrackedEditor } from './trackedEditor';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { createCollaborationExtension, undo } from '@/components/editor/plugins/collaboration';
import { AgentEditPreview } from '@/components/editor/plugins/AgentEditPreview';
import { activeEditor, registerActiveEditor } from '@/lib/agent/activeEditor';
import { acceptEdit, approveEdit, pendingEdits, rejectEdit, type BuiltEdit, type EditProposal } from '@/lib/agent/approveEdit';
import { AGENT_TOOLS, runAgent, type AgentEngine, type AgentMessage } from '@/lib/agent/loop/agentLoop';
import { formatText, insertParagraph, replaceText, setBlockType, type EditorTool } from '@/lib/agent/tools/editor';
import type { ReadDeps } from '@/lib/agent/tools/read';

let editor: Editor;
let unregister: () => void;

function open(html: string) {
    editor = createTrackedEditor({
        element: document.body.appendChild(document.createElement('div')),
        extensions: [...createBaseExtensions(), createCollaborationExtension(new Y.Doc().getXmlFragment('prosemirror')), AgentEditPreview],
    });
    editor.commands.setContent(html);
    unregister = registerActiveEditor({ docId: 'note', editor, editable: true, excludeFromAI: false });
}

afterEach(() => {
    unregister();
    document.body.replaceChildren();
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** What the loop hands `approve` for a call of `tool`. */
async function proposalOf<T extends EditorTool>(tool: T, args: Parameters<T['execute']>[1]): Promise<{ edit: EditProposal }> {
    const run = () => tool.execute(activeEditor, args);
    return { edit: { built: (await run()).data as BuiltEdit, rebuild: async () => (await run()).data as BuiltEdit } };
}

const texts = () => editor.state.doc.children.map((c) => c.textContent);
const types = () => editor.state.doc.children.map((c) => c.type.name);
const boldRuns = () =>
    editor.state.doc.children.flatMap((c) => c.children.filter((n) => n.marks.some((m) => m.type.name === 'bold')).map((n) => n.text));

describe('approveEdit', () => {
    it('applies nothing until Accept, then one undo restores the note exactly and keeps the typing before it', async () => {
        open('<p>one</p><p>two</p>');
        editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' typed');
        const before = editor.getJSON();

        const outcome = approveEdit(await proposalOf(formatText, { n: 2, mark: 'bold', on: true }));
        const item = pendingEdits.current(editor)!;
        expect(item.summary).toBe('Make paragraph 2 bold');
        expect(editor.getJSON()).toEqual(before);

        await acceptEdit(item);
        expect(await outcome).toBe('accepted');
        expect(boldRuns()).toEqual(['two typed']);

        expect(undo(editor.state)).toBe(true);
        expect(editor.getJSON()).toEqual(before);
        expect(texts()).toEqual(['one', 'two typed']);
    });

    it('leaves the note unchanged on Reject', async () => {
        open('<p>one</p><p>two</p>');
        const before = editor.getJSON();

        const outcome = approveEdit(await proposalOf(setBlockType, { n: 1, type: 'h1' }));
        rejectEdit(pendingEdits.current(editor)!);

        expect(await outcome).toBe('rejected');
        expect(editor.getJSON()).toEqual(before);
        expect(pendingEdits.current(editor)).toBeNull();
    });

    it('keeps text typed between the proposal and Accept', async () => {
        open('<p>one</p><p>two</p>');
        const outcome = approveEdit(await proposalOf(replaceText, { n: 2, find: 'two', replace: '2' }));

        editor.commands.insertContentAt(1, 'first: ');
        await acceptEdit(pendingEdits.current(editor)!);

        expect(await outcome).toBe('accepted');
        expect(texts()).toEqual(['first: one', '2']);
    });

    it('returns notApplied when the text to change has gone', async () => {
        open('<p>one</p><p>two</p>');
        const outcome = approveEdit(await proposalOf(replaceText, { n: 2, find: 'two', replace: '2' }));

        editor.commands.deleteRange({ from: 6, to: 9 });
        expect(texts()).toEqual(['one', '']);
        await acceptEdit(pendingEdits.current(editor)!);

        expect(await outcome).toEqual({ notApplied: '"two" is not in block 2.' });
        expect(texts()).toEqual(['one', '']);
        expect(pendingEdits.current(editor)).toBeNull();
    });

    it('rejects the edit when the note is closed or another tab becomes active', async () => {
        open('<p>one</p>');
        const closed = approveEdit(await proposalOf(setBlockType, { n: 1, type: 'h2' }));
        unregister();
        expect(await closed).toBe('rejected');
        expect(pendingEdits.current(editor)).toBeNull();

        unregister = registerActiveEditor({ docId: 'note', editor, editable: true, excludeFromAI: false });
        const switched = approveEdit(await proposalOf(setBlockType, { n: 1, type: 'h2' }));
        const other = createTrackedEditor({ extensions: createBaseExtensions(), content: '<p>other</p>' });
        unregister();
        unregister = registerActiveEditor({ docId: 'other', editor: other, editable: true, excludeFromAI: false });
        expect(await switched).toBe('rejected');
        expect(texts()).toEqual(['one']);
    });

    it('keeps the edit when the same note registers again', async () => {
        open('<p>one</p>');
        const outcome = approveEdit(await proposalOf(setBlockType, { n: 1, type: 'h2' }));
        unregister();
        unregister = registerActiveEditor({ docId: 'note', editor, editable: true, excludeFromAI: false });
        await tick();
        expect(pendingEdits.current(editor)).not.toBeNull();
        await acceptEdit(pendingEdits.current(editor)!);
        expect(await outcome).toBe('accepted');
    });

    it('shows one edit at a time and the next waits until the first is answered', async () => {
        open('<p>one</p><p>two</p>');
        const first = approveEdit(await proposalOf(setBlockType, { n: 1, type: 'h1' }));
        const second = approveEdit(await proposalOf(setBlockType, { n: 2, type: 'h2' }));
        expect(pendingEdits.current(editor)!.summary).toBe('Turn paragraph 1 into h1');

        rejectEdit(pendingEdits.current(editor)!);
        expect(await first).toBe('rejected');
        expect(pendingEdits.current(editor)!.summary).toBe('Turn paragraph 2 into h2');

        await acceptEdit(pendingEdits.current(editor)!);
        expect(await second).toBe('accepted');
        expect(types().slice(0, 2)).toEqual(['paragraph', 'heading']);
    });

    it('rejects when the run is stopped', async () => {
        open('<p>one</p>');
        const controller = new AbortController();
        const outcome = approveEdit(await proposalOf(setBlockType, { n: 1, type: 'h2' }), controller.signal);
        controller.abort();
        expect(await outcome).toBe('rejected');
        expect(pendingEdits.current(editor)).toBeNull();
    });
});

describe('the preview in the note', () => {
    const dom = () => editor.view.dom;

    it('marks the change and shows the bar without touching the note', async () => {
        open('<p>one</p><p>two words</p>');
        const before = editor.getJSON();

        void approveEdit(await proposalOf(replaceText, { n: 2, find: 'words', replace: 'things' }));

        expect(dom().querySelector('.agent-edit-removed')?.textContent).toBe('words');
        expect(dom().querySelector('.agent-edit-inserted')?.textContent).toBe('things');
        expect(dom().querySelectorAll('.agent-edit-block')).toHaveLength(1);
        expect(dom().querySelector('.agent-edit-bar')?.textContent).toContain('Replace "words" with "things" in paragraph 2');
        expect(editor.getJSON()).toEqual(before);

        rejectEdit(pendingEdits.current(editor)!);
        expect(dom().querySelector('.agent-edit-bar')).toBeNull();
        expect(dom().querySelector('.agent-edit-removed')).toBeNull();
    });

    it('shows a new block before it exists, and a format change on its text', async () => {
        open('<p>one</p>');
        void approveEdit(await proposalOf(insertParagraph, { after: 0, text: 'Plan' }));
        expect(dom().querySelector('.agent-edit-inserted-block')?.textContent).toBe('Plan');
        expect(texts()).toEqual(['one']);
        rejectEdit(pendingEdits.current(editor)!);

        void approveEdit(await proposalOf(formatText, { n: 1, find: 'on', mark: 'bold', on: true }));
        expect(dom().querySelector('.agent-edit-format')?.textContent).toBe('on');
    });

    it('moves focus to the bar, Enter accepts, and focus returns to the editor', async () => {
        open('<p>one</p>');
        const outcome = approveEdit(await proposalOf(setBlockType, { n: 1, type: 'h2' }));
        const bar = dom().querySelector<HTMLElement>('.agent-edit-bar')!;
        await vi.waitFor(() => expect(document.activeElement).toBe(bar));

        bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(await outcome).toBe('accepted');
        expect(types()[0]).toBe('heading');
        await vi.waitFor(() => expect(editor.view.hasFocus()).toBe(true));
    });

    it('Escape rejects and the Accept and Reject buttons answer', async () => {
        open('<p>one</p>');
        let outcome = approveEdit(await proposalOf(setBlockType, { n: 1, type: 'h2' }));
        dom().querySelector('.agent-edit-bar')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(await outcome).toBe('rejected');
        expect(texts()).toEqual(['one']);

        outcome = approveEdit(await proposalOf(setBlockType, { n: 1, type: 'h2' }));
        const [accept, reject] = [...dom().querySelectorAll<HTMLButtonElement>('.agent-edit-bar button')];
        expect([accept.textContent, reject.textContent]).toEqual(['Accept', 'Reject']);
        accept.click();
        expect(await outcome).toBe('accepted');
        expect(types()[0]).toBe('heading');
    });

    it('keeps the preview while another change arrives', async () => {
        open('<p>one</p><p>two words</p>');
        void approveEdit(await proposalOf(replaceText, { n: 2, find: 'words', replace: 'things' }));
        editor.commands.insertContentAt(1, 'zero ');
        expect(dom().querySelector('.agent-edit-removed')?.textContent).toBe('words');
        expect(dom().querySelector('.agent-edit-bar')).not.toBeNull();
    });
});

describe('the agent loop with the edit tools', () => {
    const deps = {} as ReadDeps;

    /** Replies with `turns` in order and records what the model was asked. */
    function scripted(...turns: object[]) {
        const asked: string[] = [];
        const engine: AgentEngine = {
            generate: async (messages: AgentMessage[]) => {
                asked.push(messages.map((m) => m.content).join('\n'));
                return JSON.stringify(turns[asked.length - 1]);
            },
        };
        return { engine, asked };
    }

    it('reads the open note, previews the edit, applies it on Accept and tells the model', async () => {
        open('<p>one</p><p>two</p>');
        const { engine, asked } = scripted(
            { tool: 'read_open_note', args: {} },
            { tool: 'format_text', args: { n: 2, mark: 'bold', on: true } },
            { answer: 'Done.' }
        );
        const answer = runAgent('Bold the second paragraph', {
            engine,
            deps,
            approve: (proposal) => {
                const outcome = approveEdit(proposal);
                void tick().then(() => acceptEdit(pendingEdits.current(editor)!));
                return outcome;
            },
        });

        expect(await answer).toBe('Done.');
        expect(boldRuns()).toEqual(['two']);
        expect(asked[1]).toContain('{"n":2,"type":"paragraph","text":"two"}');
        expect(asked[2]).toContain('Result of format_text: accepted');
    });

    it('sends a rejected edit back to the model, and an edit that cannot be built as an error without asking', async () => {
        open('<p>one</p>');
        const approve = vi.fn(async () => 'rejected' as const);
        const { engine, asked } = scripted(
            { tool: 'replace_text', args: { n: 1, find: 'zzz', replace: 'x' } },
            { tool: 'replace_text', args: { n: 1, find: 'one', replace: '1' } },
            { answer: 'ok' }
        );
        await runAgent('Change it', { engine, deps, approve });

        expect(approve).toHaveBeenCalledTimes(1);
        expect(asked[1]).toContain('"zzz" is not in block 1.');
        expect(asked[2]).toContain('rejected by the user');
        expect(texts()).toEqual(['one']);
    });

    it('passes an unapplied edit to the model with the reason', async () => {
        open('<p>one</p>');
        const { engine, asked } = scripted({ tool: 'replace_text', args: { n: 1, find: 'one', replace: '1' } }, { answer: 'ok' });
        await runAgent('Change it', { engine, deps, approve: async () => ({ notApplied: 'gone' }) });
        expect(asked[1]).toContain('not applied: gone');
    });

    it('lists at most 8 tools, with the editor tools in', () => {
        expect(AGENT_TOOLS.length).toBeLessThanOrEqual(8);
        expect(AGENT_TOOLS.map((t) => t.name)).toEqual(
            expect.arrayContaining(['read_open_note', 'insert_paragraph', 'set_block_type', 'replace_text', 'format_text'])
        );
    });
});
