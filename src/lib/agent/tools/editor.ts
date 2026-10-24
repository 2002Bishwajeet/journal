/**
 * The in-app agent's tools for the open note (#700). Their deps are the active-editor bridge,
 * not WriteDeps, so they are not in TOOLS; AGENT_TOOLS has them (#701). The edit tools
 * return a proposal ({ tr, summary }) and never dispatch it.
 */
import { z } from 'zod';
import type { ActiveEditorStore } from '@/lib/agent/activeEditor';
import { BLOCK_TYPES, MARKS, buildEdit, readBlocks, type EditOp } from '@/lib/agent/editorOps';
import type { ToolOutput } from './registry';

export interface EditorTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
    /** Tells the agent loop to run this tool on the open note's editor, not on WriteDeps. */
    editor: true;
    name: string;
    title: string;
    description: string;
    input: z.ZodObject<Shape>;
    readOnly: boolean;
    execute(deps: ActiveEditorStore, args: z.infer<z.ZodObject<Shape>>): Promise<ToolOutput>;
}

function openEditor(deps: ActiveEditorStore) {
    const open = deps.get();
    if (!open) throw new Error('No note is open.');
    if (open.excludeFromAI) throw new Error('This note is excluded from AI.');
    if (!open.editable) throw new Error('This note is read-only.');
    return open.editor;
}

const n = z.number().int().min(1);

function editTool<Shape extends z.ZodRawShape>(
    spec: Pick<EditorTool<Shape>, 'name' | 'title' | 'description' | 'input'>,
    toOp: (args: z.infer<z.ZodObject<Shape>>) => EditOp
): EditorTool<Shape> {
    return {
        ...spec,
        editor: true,
        readOnly: false,
        execute: async (deps, args) => {
            const result = buildEdit(openEditor(deps).state, toOp(args));
            if ('error' in result) throw new Error(result.error);
            return { data: result };
        },
    };
}

export const readOpenNote: EditorTool = {
    editor: true,
    name: 'read_open_note',
    title: 'Read open note',
    description: 'The top-level blocks of the note the user has open, as [{ n, type, text }]. n counts from 1; text is cut to 200 characters.',
    input: z.object({}),
    readOnly: true,
    execute: async (deps) => ({ data: readBlocks(openEditor(deps).state.doc) }),
};

export const insertParagraph = editTool(
    {
        name: 'insert_paragraph',
        title: 'Insert paragraph',
        description: 'Propose a new paragraph after block n of the open note (0 = at the top).',
        input: z.object({ after: z.number().int().min(0), text: z.string() }),
    },
    ({ after, text }) => ({ kind: 'insert_paragraph', after, text })
);

export const setBlockType = editTool(
    {
        name: 'set_block_type',
        title: 'Set block type',
        description: 'Propose changing block n of the open note to a paragraph, heading (h1-h3), bullet, numbered or task list, or quote.',
        input: z.object({ n, type: z.enum(BLOCK_TYPES) }),
    },
    ({ n, type }) => ({ kind: 'set_block_type', n, type })
);

export const replaceText = editTool(
    {
        name: 'replace_text',
        title: 'Replace text',
        description: 'Propose replacing `find` with `replace` in block n of the open note. `find` must occur exactly once in the block.',
        input: z.object({ n, find: z.string(), replace: z.string() }),
    },
    ({ n, find, replace }) => ({ kind: 'replace_text', n, find, replace })
);

export const formatText = editTool(
    {
        name: 'format_text',
        title: 'Format text',
        description: 'Propose turning bold, italic, strike or code on or off for `find` (exactly once) in block n of the open note, or the whole block without `find`.',
        input: z.object({ n, find: z.string().optional(), mark: z.enum(MARKS), on: z.boolean() }),
    },
    ({ n, find, mark, on }) => ({ kind: 'format_text', n, find, mark, on })
);
