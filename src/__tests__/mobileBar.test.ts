/** #1272: which bar the phone editor shows for a selection, the Aa panel height, and indent steps. */
import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { AllSelection, EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { getMobileBar, getStylePanelHeight, MAX_INDENT, shiftIndent } from '@/lib/editor/mobileBar';

const schema = getSchema(createBaseExtensions());
const p = (text: string, attrs: Record<string, unknown> | null = null) => schema.node('paragraph', attrs, [schema.text(text)]);
const cell = (text: string) => schema.node('tableCell', null, [p(text)]);

// <p>Hello world</p><p><img></p><pre>code</pre><table>a b</table>. Images are inline.
const doc = schema.node('doc', null, [
    p('Hello world'),
    schema.node('paragraph', null, [schema.node('image', { src: 'x.png' })]),
    schema.node('codeBlock', null, [schema.text('code')]),
    schema.node('table', null, [schema.node('tableRow', null, [cell('a'), cell('b')])]),
]);
const imagePos = doc.child(0).nodeSize + 1;
const codeStart = doc.child(0).nodeSize + doc.child(1).nodeSize + 1;
const tableStart = codeStart - 1 + doc.child(2).nodeSize;

describe('getMobileBar', () => {
    it('should show the insert bar for a caret', () => {
        expect(getMobileBar(TextSelection.create(doc, 3))).toBe('insert');
    });

    it('should show the format bar for a text selection', () => {
        expect(getMobileBar(TextSelection.create(doc, 1, 6))).toBe('format');
    });

    it('should show the format bar for select all', () => {
        expect(getMobileBar(new AllSelection(doc))).toBe('format');
    });

    it('should keep the insert bar for a selected image', () => {
        expect(getMobileBar(NodeSelection.create(doc, imagePos))).toBe('insert');
    });

    it('should keep the insert bar for text selected inside a code block', () => {
        expect(getMobileBar(TextSelection.create(doc, codeStart, codeStart + 4))).toBe('insert');
    });

    it('should keep the insert bar for selected table cells', () => {
        const row = tableStart + 1;
        const second = row + 1 + doc.child(3).child(0).child(0).nodeSize;
        expect(getMobileBar(CellSelection.create(doc, row + 1, second))).toBe('insert');
    });
});

describe('getStylePanelHeight', () => {
    it('should take the keyboard height when a keyboard is up', () => {
        expect(getStylePanelHeight(336)).toBe(336);
    });

    it('should be unknown with no keyboard offset or only a shortcut bar', () => {
        expect(getStylePanelHeight(0)).toBeNull();
        expect(getStylePanelHeight(55)).toBeNull();
    });
});

describe('shiftIndent', () => {
    const indents = (state: EditorState) => {
        const out: number[] = [];
        state.doc.forEach((node) => out.push(node.attrs.indent as number));
        return out;
    };
    const paragraphs = schema.node('doc', null, [p('one'), p('two'), p('three')]);
    const across = (state: EditorState) => TextSelection.create(state.doc, 2, state.doc.child(0).nodeSize + 2);

    it('should indent and outdent every paragraph in the selection', () => {
        let state = EditorState.create({ schema, doc: paragraphs });
        state = state.apply(state.tr.setSelection(across(state)));
        const tr = state.tr;
        expect(shiftIndent(tr, 1)).toBe(true);
        state = state.apply(tr);
        expect(indents(state)).toEqual([1, 1, 0]);

        const back = state.tr;
        expect(shiftIndent(back, -1)).toBe(true);
        expect(indents(state.apply(back))).toEqual([0, 0, 0]);
    });

    it('should stop at 0 and at MAX_INDENT', () => {
        const flat = EditorState.create({ schema, doc: paragraphs, selection: TextSelection.create(paragraphs, 2) });
        expect(shiftIndent(flat.tr, -1)).toBe(false);

        const deep = schema.node('doc', null, [p('deep', { indent: MAX_INDENT })]);
        const state = EditorState.create({ schema, doc: deep, selection: TextSelection.create(deep, 2) });
        expect(shiftIndent(state.tr, 1)).toBe(false);
    });
});
