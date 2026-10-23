/**
 * Small, structured edits to the open note (#700). Each builds a ProseMirror transaction
 * from the given state and never dispatches it, so the caller can preview it and apply
 * it on Accept (#701). Blocks are the doc's top-level nodes, numbered from 1.
 */
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Node as PMNode, Fragment } from '@tiptap/pm/model';

export const BLOCK_TYPES = ['paragraph', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'task', 'quote'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
export const MARKS = ['bold', 'italic', 'strike', 'code'] as const;
export type MarkName = (typeof MARKS)[number];

export type EditOp =
    | { kind: 'insert_paragraph'; after: number; text: string }
    | { kind: 'set_block_type'; n: number; type: BlockType }
    | { kind: 'replace_text'; n: number; find: string; replace: string }
    | { kind: 'format_text'; n: number; find?: string; mark: MarkName; on: boolean };

export type EditResult = { tr: Transaction; summary: string } | { error: string };

const TEXT_CUT = 200;

export function blockType(node: PMNode): string {
    switch (node.type.name) {
        case 'heading':
            return `h${node.attrs.level}`;
        case 'bulletList':
            return 'bullet';
        case 'orderedList':
            return 'numbered';
        case 'taskList':
            return 'task';
        case 'blockquote':
            return 'quote';
        default:
            return node.type.name;
    }
}

export function readBlocks(doc: PMNode): { n: number; type: string; text: string }[] {
    const blocks: { n: number; type: string; text: string }[] = [];
    doc.forEach((node, _offset, i) =>
        blocks.push({ n: i + 1, type: blockType(node), text: node.textBetween(0, node.content.size, '\n', '\n').slice(0, TEXT_CUT) })
    );
    return blocks;
}

const label = (type: string) =>
    type === 'paragraph'
        ? 'paragraph'
        : /^h\d$/.test(type)
          ? 'heading'
          : ['bullet', 'numbered', 'task'].includes(type)
            ? 'list'
            : type === 'quote'
              ? 'quote'
              : 'block';

function findBlock(doc: PMNode, n: number): { node: PMNode; start: number } | { error: string } {
    if (!Number.isInteger(n) || n < 1 || n > doc.childCount) {
        return { error: `No block ${n}; the note has ${doc.childCount} block${doc.childCount === 1 ? '' : 's'}.` };
    }
    let start = 0;
    for (let i = 0; i < n - 1; i++) start += doc.child(i).nodeSize;
    return { node: doc.child(n - 1), start };
}

/** Each textblock inside the block at `start`, with its text start position. Inline leaves count one character, so offsets map to positions. */
function textblocks(block: PMNode, start: number): { text: string; pos: number }[] {
    const out: { text: string; pos: number }[] = [];
    const text = (node: PMNode) => node.textBetween(0, node.content.size, undefined, '￼');
    if (block.isTextblock) return [{ text: text(block), pos: start + 1 }];
    block.descendants((child, offset) => {
        if (!child.isTextblock) return;
        out.push({ text: text(child), pos: start + 1 + offset + 1 });
        return false;
    });
    return out;
}

function uniqueMatch(block: PMNode, start: number, n: number, needle: string): { from: number; to: number } | { error: string } {
    if (!needle) return { error: 'find must not be empty.' };
    const matches: { from: number; to: number }[] = [];
    for (const { text, pos } of textblocks(block, start)) {
        for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
            matches.push({ from: pos + i, to: pos + i + needle.length });
        }
    }
    if (matches.length === 1) return matches[0];
    return { error: matches.length ? `"${needle}" occurs ${matches.length} times in block ${n}; use a longer find.` : `"${needle}" is not in block ${n}.` };
}

function convert(state: EditorState, block: PMNode, type: BlockType): PMNode[] | { error: string } {
    const { nodes } = state.schema;
    const lines: Fragment[] = [];
    if (block.isTextblock) lines.push(block.content);
    else
        block.descendants((child) => {
            if (!child.isTextblock) return;
            lines.push(child.content);
            return false;
        });
    if (!lines.length) return { error: 'This block has no text to convert.' };
    const para = (c: Fragment) => nodes.paragraph.create(null, c);
    switch (type) {
        case 'paragraph':
            return lines.map(para);
        case 'h1':
        case 'h2':
        case 'h3':
            return lines.map((c) => nodes.heading.create({ level: Number(type[1]) }, c));
        case 'bullet':
            return [nodes.bulletList.create(null, lines.map((c) => nodes.listItem.create(null, para(c))))];
        case 'numbered':
            return [nodes.orderedList.create(null, lines.map((c) => nodes.listItem.create(null, para(c))))];
        case 'task':
            return [nodes.taskList.create(null, lines.map((c) => nodes.taskItem.create({ checked: false }, para(c))))];
        case 'quote':
            return [nodes.blockquote.create(null, lines.map(para))];
    }
}

const CONVERTIBLE = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote'];

/** Builds the edit against `state` without dispatching it or changing `state`. */
export function buildEdit(state: EditorState, op: EditOp): EditResult {
    const { doc, schema } = state;
    const tr = state.tr;
    if (op.kind === 'insert_paragraph') {
        if (!Number.isInteger(op.after) || op.after < 0 || op.after > doc.childCount) {
            return { error: `after must be 0 to ${doc.childCount}.` };
        }
        let pos = 0;
        for (let i = 0; i < op.after; i++) pos += doc.child(i).nodeSize;
        tr.insert(pos, schema.nodes.paragraph.create(null, op.text ? schema.text(op.text) : null));
        return { tr, summary: op.after === 0 ? 'Add a paragraph at the top' : `Add a paragraph after block ${op.after}` };
    }
    const found = findBlock(doc, op.n);
    if ('error' in found) return found;
    const { node, start } = found;
    const end = start + node.nodeSize;
    const kind = label(blockType(node));
    if (op.kind === 'set_block_type') {
        if (!CONVERTIBLE.includes(node.type.name)) return { error: `Block ${op.n} is a ${node.type.name}, which can't change type.` };
        if (blockType(node) === op.type) return { error: `Block ${op.n} is already ${op.type}.` };
        const next = convert(state, node, op.type);
        if ('error' in next) return next;
        tr.replaceWith(start, end, next);
        return { tr, summary: `Turn ${kind} ${op.n} into ${op.type === 'paragraph' ? 'a paragraph' : op.type}` };
    }
    if (op.kind === 'replace_text') {
        const m = uniqueMatch(node, start, op.n, op.find);
        if ('error' in m) return m;
        tr.insertText(op.replace, m.from, m.to);
        return { tr, summary: `Replace "${op.find}" with "${op.replace}" in ${kind} ${op.n}` };
    }
    const range = op.find === undefined ? { from: start + 1, to: end - 1 } : uniqueMatch(node, start, op.n, op.find);
    if ('error' in range) return range;
    const mark = schema.marks[op.mark];
    if (!mark) return { error: `The editor has no ${op.mark} mark.` };
    if (op.on) tr.addMark(range.from, range.to, mark.create());
    else tr.removeMark(range.from, range.to, mark);
    const target = op.find === undefined ? `${kind} ${op.n}` : `"${op.find}" in ${kind} ${op.n}`;
    return { tr, summary: op.on ? `Make ${target} ${op.mark}` : `Remove ${op.mark} from ${target}` };
}
