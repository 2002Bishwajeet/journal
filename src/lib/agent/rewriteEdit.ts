/**
 * A rewrite of the selected text, as an edit for `approveEdit` (#703): the editor model's
 * result replaces exactly the selected range, shown in the note like the assistant's edits.
 */
import type { Editor } from '@tiptap/react';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { looksLikeMarkdownTable, parseMarkdownTable } from '@/lib/utils/markdownTableParser';
import { NOT_APPLIED_MESSAGE, type BuiltEdit, type EditProposal } from './approveEdit';

/** The edit that replaces `from`-`to` with `result`; a table result becomes a table. */
function build(state: EditorState, from: number, to: number, result: string, asTable: boolean, summary: string): BuiltEdit {
    const { schema, tr } = state;
    if (asTable && looksLikeMarkdownTable(result)) {
        tr.replaceRangeWith(from, to, schema.nodeFromJSON(parseMarkdownTable(result)));
    } else {
        const lines = result.trim().split(/\n+/);
        if (lines.length === 1) tr.insertText(lines[0], from, to);
        else {
            const paragraphs = lines.map((line) => schema.nodes.paragraph.create(null, schema.text(line)));
            tr.replaceRange(from, to, new Slice(Fragment.from(paragraphs), 1, 1));
        }
    }
    return { tr, summary };
}

/**
 * The proposal to replace the text `original` at `from`-`to` with `result`. Accept builds it
 * again, and fails when the note no longer has `original` at that range.
 */
export function rewriteProposal(
    editor: Editor,
    range: { from: number; to: number; original: string },
    result: string,
    options: { asTable: boolean; label: string }
): EditProposal {
    const { from, to, original } = range;
    const summary = `Rewrite the selected text (${options.label})`;
    const make = () => {
        const { state } = editor;
        if (state.doc.textBetween(from, to, ' ') !== original) throw new Error(NOT_APPLIED_MESSAGE);
        return build(state, from, to, result, options.asTable, summary);
    };
    return { built: make(), rebuild: async () => make() };
}
