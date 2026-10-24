import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { editorSchema } from '@/lib/agent/editEngine';
import { buildEdit, type EditOp } from '@/lib/agent/editorOps';
import { activeEditor, registerActiveEditor } from '@/lib/agent/activeEditor';
import { formatText, insertParagraph, readOpenNote, replaceText, setBlockType } from '@/lib/agent/tools/editor';

const doc = (...content: object[]) => editorSchema.nodeFromJSON({ type: 'doc', content });
const p = (text: string, marks?: string[]) => ({
    type: 'paragraph',
    content: [{ type: 'text', text, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) }],
});
const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const item = (text: string) => ({ type: 'listItem', content: [p(text)] });
const stateOf = (...content: object[]) => EditorState.create({ doc: doc(...content) });
const apply = (state: EditorState, op: EditOp) => {
    const r = buildEdit(state, op);
    if ('error' in r) throw new Error(r.error);
    return { next: state.apply(r.tr), summary: r.summary };
};
const types = (s: EditorState) => s.doc.children.map((c) => c.type.name);

describe('insert_paragraph', () => {
    const state = stateOf(p('one'), p('two'), p('three'));
    it.each([
        [0, ['new', 'one', 'two', 'three']],
        [1, ['one', 'new', 'two', 'three']],
        [3, ['one', 'two', 'three', 'new']],
    ])('after %i', (after, expected) => {
        const { next } = apply(state, { kind: 'insert_paragraph', after, text: 'new' });
        expect(next.doc.children.map((c) => c.textContent)).toEqual(expected);
    });
    it('rejects out of range', () => {
        expect(buildEdit(state, { kind: 'insert_paragraph', after: 4, text: 'x' })).toHaveProperty('error');
    });
});

describe('set_block_type', () => {
    it('heading to paragraph', () => {
        const { next } = apply(stateOf(h(2, 'Title')), { kind: 'set_block_type', n: 1, type: 'paragraph' });
        expect(types(next)).toEqual(['paragraph']);
        expect(next.doc.textContent).toBe('Title');
    });
    it('paragraph to task list', () => {
        const { next } = apply(stateOf(p('a'), p('b')), { kind: 'set_block_type', n: 2, type: 'task' });
        expect(types(next)).toEqual(['paragraph', 'taskList']);
        expect(next.doc.child(1).child(0).type.name).toBe('taskItem');
    });
    it('bullet to numbered keeps every item', () => {
        const { next } = apply(stateOf({ type: 'bulletList', content: [item('a'), item('b')] }), { kind: 'set_block_type', n: 1, type: 'numbered' });
        expect(types(next)).toEqual(['orderedList']);
        expect(next.doc.child(0).childCount).toBe(2);
    });
    it('rejects a block that cannot change type and the same type', () => {
        expect(buildEdit(stateOf({ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }), { kind: 'set_block_type', n: 1, type: 'h1' })).toHaveProperty('error');
        expect(buildEdit(stateOf(p('a')), { kind: 'set_block_type', n: 1, type: 'paragraph' })).toHaveProperty('error');
    });
});

describe('replace_text', () => {
    const state = stateOf(p('hello world'), p('aa bb aa'));
    it('replaces a single match', () => {
        const { next } = apply(state, { kind: 'replace_text', n: 1, find: 'world', replace: 'there' });
        expect(next.doc.child(0).textContent).toBe('hello there');
    });
    it('refuses 0 and 2 matches', () => {
        expect(buildEdit(state, { kind: 'replace_text', n: 1, find: 'zzz', replace: 'x' })).toHaveProperty('error');
        expect(buildEdit(state, { kind: 'replace_text', n: 2, find: 'aa', replace: 'x' })).toHaveProperty('error');
    });
});

describe('format_text', () => {
    const state = stateOf(p('make this bold'));
    const bold = (s: EditorState) => s.doc.child(0).children.filter((c) => c.marks.some((m) => m.type.name === 'bold')).map((c) => c.text);
    it('bolds a find span, then removes it', () => {
        const { next, summary } = apply(state, { kind: 'format_text', n: 1, find: 'this', mark: 'bold', on: true });
        expect(bold(next)).toEqual(['this']);
        expect(summary).toBe('Make "this" in paragraph 1 bold');
        expect(bold(apply(next, { kind: 'format_text', n: 1, find: 'this', mark: 'bold', on: false }).next)).toEqual([]);
    });
    it('bolds the whole block, then removes it', () => {
        const { next, summary } = apply(state, { kind: 'format_text', n: 1, mark: 'bold', on: true });
        expect(bold(next)).toEqual(['make this bold']);
        expect(summary).toBe('Make paragraph 1 bold');
        expect(bold(apply(next, { kind: 'format_text', n: 1, mark: 'bold', on: false }).next)).toEqual([]);
    });
});

describe('buildEdit', () => {
    it('errors on an out-of-range n', () => {
        const state = stateOf(p('a'));
        for (const n of [0, 2]) {
            expect(buildEdit(state, { kind: 'replace_text', n, find: 'a', replace: 'b' })).toHaveProperty('error');
        }
    });
    it('does not change the state it was given', () => {
        const state = stateOf(p('hello'));
        const before = state.doc.toJSON();
        buildEdit(state, { kind: 'replace_text', n: 1, find: 'hello', replace: 'bye' });
        expect(state.doc.toJSON()).toEqual(before);
    });
});

const fakeEditor = (state: EditorState) => ({ state }) as unknown as Editor;

describe('tools', () => {
    const state = stateOf(h(2, 'Title'), { type: 'bulletList', content: [item('a'), item('b')] }, p('x'.repeat(250)));
    it('read_open_note lists blocks', async () => {
        const off = registerActiveEditor({ docId: 'd', editor: fakeEditor(state), editable: true, excludeFromAI: false });
        const { data } = await readOpenNote.execute(activeEditor, {});
        off();
        expect(data).toEqual([
            { n: 1, type: 'h2', text: 'Title' },
            { n: 2, type: 'bullet', text: 'a\nb' },
            { n: 3, type: 'paragraph', text: 'x'.repeat(200) },
        ]);
    });
    it('an edit tool returns a proposal without dispatching', async () => {
        const off = registerActiveEditor({ docId: 'd', editor: fakeEditor(state), editable: true, excludeFromAI: false });
        const { data } = (await insertParagraph.execute(activeEditor, { after: 0, text: 'hi' })) as { data: { summary: string } };
        off();
        expect(data.summary).toBe('Add a paragraph at the top');
    });
    it('errors with no note, a read-only note and an excludeFromAI note', async () => {
        await expect(readOpenNote.execute(activeEditor, {})).rejects.toThrow('No note is open');
        const entry = { docId: 'd', editor: fakeEditor(state) };
        let off = registerActiveEditor({ ...entry, editable: false, excludeFromAI: false });
        await expect(setBlockType.execute(activeEditor, { n: 1, type: 'paragraph' })).rejects.toThrow('read-only');
        off();
        off = registerActiveEditor({ ...entry, editable: true, excludeFromAI: true });
        await expect(replaceText.execute(activeEditor, { n: 1, find: 'Title', replace: 'T' })).rejects.toThrow('excluded');
        await expect(formatText.execute(activeEditor, { n: 1, mark: 'bold', on: true })).rejects.toThrow('excluded');
        off();
    });
});

describe('active editor bridge', () => {
    it('holds only the active tab: an inactive tab clearing leaves the active one', () => {
        const a = { docId: 'a', editor: fakeEditor(stateOf(p('a'))), editable: true, excludeFromAI: false };
        const b = { ...a, docId: 'b' };
        const offA = registerActiveEditor(a);
        const offB = registerActiveEditor(b);
        expect(activeEditor.get()?.docId).toBe('b');
        offA();
        expect(activeEditor.get()?.docId).toBe('b');
        offB();
        expect(activeEditor.get()).toBeNull();
    });
    it('notifies subscribers', () => {
        let calls = 0;
        const unsub = activeEditor.subscribe(() => calls++);
        const off = registerActiveEditor({ docId: 'a', editor: fakeEditor(stateOf(p('a'))), editable: true, excludeFromAI: false });
        off();
        unsub();
        expect(calls).toBe(2);
    });
});
