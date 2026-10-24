// @vitest-environment happy-dom
/**
 * #703: a rewrite of the selected text is a proposal that replaces exactly the selected range.
 * It shows as a preview, changes the note on Accept as one undo step, and fails when the note
 * no longer has the selected text there. The AI slash commands go through `aiRequests`.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import * as Y from 'yjs';
import { createTrackedEditor } from './trackedEditor';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { createCollaborationExtension, undo } from '@/components/editor/plugins/collaboration';
import { AgentEditPreview } from '@/components/editor/plugins/AgentEditPreview';
import { registerActiveEditor } from '@/lib/agent/activeEditor';
import { aiRequests } from '@/lib/agent/aiRequests';
import { acceptEdit, approveEdit, pendingEdits, rejectEdit } from '@/lib/agent/approveEdit';
import { rewriteProposal } from '@/lib/agent/rewriteEdit';

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

const texts = () => editor.state.doc.children.map((c) => c.textContent);

/** Selects `text` in the note and returns its range. */
function select(text: string) {
    let found = { from: 0, to: 0, original: text };
    editor.state.doc.descendants((node, pos) => {
        const at = node.isText ? (node.text ?? '').indexOf(text) : -1;
        if (at >= 0) found = { from: pos + at, to: pos + at + text.length, original: text };
    });
    editor.commands.setTextSelection(found);
    return found;
}

describe('rewriteProposal', () => {
    it('replaces exactly the selected range on Accept, and one undo restores it', async () => {
        open('<p>keep this. Change this sentence now. keep that.</p><p>other</p>');
        const before = editor.getJSON();
        const range = select('Change this sentence now.');

        const outcome = approveEdit({ edit: rewriteProposal(editor, range, 'Change this.', { asTable: false, label: 'Concise' }) });
        const item = pendingEdits.current(editor)!;
        expect(item.summary).toBe('Rewrite the selected text (Concise)');
        expect(editor.getJSON()).toEqual(before);

        await acceptEdit(item);
        expect(await outcome).toBe('accepted');
        expect(texts()).toEqual(['keep this. Change this. keep that.', 'other']);

        expect(undo(editor.state)).toBe(true);
        expect(editor.getJSON()).toEqual(before);
    });

    it('leaves the note as it was on Reject', async () => {
        open('<p>one two three</p>');
        const before = editor.getJSON();
        const outcome = approveEdit({ edit: rewriteProposal(editor, select('two'), 'TWO', { asTable: false, label: 'Rewrite' }) });
        rejectEdit(pendingEdits.current(editor)!);
        expect(await outcome).toBe('rejected');
        expect(editor.getJSON()).toEqual(before);
    });

    it('is not applied when the selected text changed while it waited', async () => {
        open('<p>one two three</p>');
        const outcome = approveEdit({ edit: rewriteProposal(editor, select('two'), 'TWO', { asTable: false, label: 'Rewrite' }) });
        editor.commands.insertContentAt(2, 'x');
        expect(await acceptEdit(pendingEdits.current(editor)!)).toEqual({ notApplied: expect.any(String) });
        expect(await outcome).toEqual({ notApplied: expect.any(String) });
        expect(texts()).toEqual(['oxne two three']);
    });

    it('turns a result with several lines into paragraphs inside the range', async () => {
        open('<p>before MIDDLE after</p>');
        const outcome = approveEdit({ edit: rewriteProposal(editor, select('MIDDLE'), 'first\nsecond', { asTable: false, label: 'List' }) });
        await acceptEdit(pendingEdits.current(editor)!);
        await outcome;
        expect(texts()).toEqual(['before first', 'second after']);
    });

    it('turns a table result into a table', async () => {
        open('<p>a b c</p>');
        const outcome = approveEdit({
            edit: rewriteProposal(editor, select('a b c'), '| Name | Age |\n|---|---|\n| John | 25 |', { asTable: true, label: 'Table' }),
        });
        await acceptEdit(pendingEdits.current(editor)!);
        await outcome;
        expect(editor.state.doc.children.map((c) => c.type.name)).toContain('table');
        expect(editor.state.doc.textContent).toContain('John');
    });
});

describe('aiRequests', () => {
    it('hands a request to every listener until it unsubscribes', () => {
        const listener = vi.fn();
        const unsubscribe = aiRequests.subscribe(listener);
        aiRequests.emit('summarize');
        unsubscribe();
        aiRequests.emit('ask');
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith('summarize');
    });
});
