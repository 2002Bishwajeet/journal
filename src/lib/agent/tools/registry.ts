/**
 * Every Journal agent tool, defined once (#694): the MCP server registers them by looping
 * over TOOLS, and the in-app agent and WebMCP (#674) read the same list. A tool maps
 * one-to-one to a WebMCP tool: `name`, `description`, a JSON Schema (`toJsonSchema`),
 * `readOnly` (annotations.readOnlyHint) and `execute`.
 */
import { z } from 'zod';
import { CALLOUT_VARIANTS } from '@/components/editor/nodes/calloutVariants';
// The full authoring reference (#519), inlined at build time so the packaged server carries it.
// mcpServer.test.ts checks it names every live-block language, react import and CDN host in code.
import AUTHORING_GUIDE from '../../../../mcp/AUTHORING.md?raw';
import * as readTools from './read';
import * as writeTools from './write';
import { liveBlockLayoutWarnings, type WriteDeps } from './write';

/** Shared by the tools that take markdown, in place of the full guide. */
const RICH_BLOCKS = ' Supports rich blocks; call get_authoring_guide before writing anything beyond plain markdown.';

/** Shared by the tools that take markdown: an image in it can be a local file or a data: URI (#415). */
const BODY_IMAGES =
    ' Images: `![alt](/absolute/path/to/file.png)` (wrap the path in <> if it has spaces) or `![alt](data:image/png;base64,…)` ' +
    'is uploaded to the note and shown there; prefer a path, it costs no tokens. PNG, JPEG or WebP, at most 5 MB each; ' +
    'metadata such as EXIF and GPS is removed. If any image is invalid, the call fails and nothing is written. ' +
    '`https://` image URLs are kept as they are, not fetched or uploaded.';

/** What a tool returns: `data` (sent as JSON, or as is with `text`) plus advisory `notes` shown after it. */
export interface ToolOutput {
    data: unknown;
    text?: boolean;
    notes?: string[];
}

export interface JournalTool<Shape extends z.ZodRawShape = z.ZodRawShape> {
    name: string;
    title: string;
    description: string;
    input: z.ZodObject<Shape>;
    /** WebMCP `annotations.readOnlyHint`. */
    readOnly: boolean;
    execute(deps: WriteDeps, args: z.infer<z.ZodObject<Shape>>): Promise<ToolOutput>;
}

// `any` so tools with different input shapes share one list; each is checked where it is defined.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyJournalTool = JournalTool<any>;

function defineTool<Shape extends z.ZodRawShape>(tool: JournalTool<Shape>): AnyJournalTool {
    return tool;
}

/** The JSON Schema of a tool's input, for WebMCP's `inputSchema`. */
export function toJsonSchema(tool: Pick<AnyJournalTool, 'input'>): z.core.JSONSchema.BaseSchema {
    return z.toJSONSchema(tool.input);
}

const index = z.number().int().min(0);

export const TOOLS: AnyJournalTool[] = [
    defineTool({
        name: 'list_folders',
        title: 'List folders',
        description: 'List the folders you have granted this agent access to, in Journal.',
        input: z.object({}),
        readOnly: true,
        execute: async (deps) => ({ data: await readTools.listFolders(deps) }),
    }),
    defineTool({
        name: 'list_notes',
        title: 'List notes',
        description: 'List granted Journal notes, newest first. Optionally scoped to one folder.',
        input: z.object({
            folderId: z.string().optional(),
            limit: z.number().int().min(1).max(200).optional(),
        }),
        readOnly: true,
        execute: async (deps, { folderId, limit }) => ({ data: await readTools.listNotes(deps, { folderId, limit }) }),
    }),
    defineTool({
        name: 'get_note',
        title: 'Get note',
        description:
            'Fetch one granted Journal note by id, with its body as markdown. ' +
            'With format "blocks", the body is a list of top-level blocks { id, type, markdown, attrs }, plus rows (cell markdown) for a table: ' +
            'the ids edit_block takes, which stay the same while the block exists.',
        input: z.object({ id: z.string(), format: z.enum(['markdown', 'blocks']).optional() }),
        readOnly: true,
        execute: async (deps, { id, format }) => ({
            data: format === 'blocks' ? await writeTools.getNoteBlocks(deps, { id }) : await readTools.getNote(deps, { id }),
        }),
    }),
    defineTool({
        name: 'search_notes',
        title: 'Search notes',
        description: 'Case-insensitive substring search over the title, tags and body of granted notes.',
        input: z.object({
            query: z.string(),
            limit: z.number().int().min(1).optional(),
        }),
        readOnly: true,
        execute: async (deps, { query, limit }) => ({ data: await readTools.searchNotes(deps, { query, limit }) }),
    }),
    defineTool({
        name: 'get_authoring_guide',
        title: 'Get authoring guide',
        description:
            'The full reference for writing Journal notes: every block a note can hold, with its markdown syntax and examples, ' +
            'how live blocks (mermaid, svg, html, react) run, and how to design them to match the note. Read it before writing rich content.',
        input: z.object({}),
        readOnly: true,
        execute: async () => ({ data: AUTHORING_GUIDE, text: true }),
    }),
    defineTool({
        name: 'create_note',
        title: 'Create note',
        description: 'Create a Journal note from markdown in a folder you have granted Read+write access to.' + BODY_IMAGES + RICH_BLOCKS,
        input: z.object({
            title: z.string(),
            markdown: z.string(),
            folderId: z.string(),
            tags: z.array(z.string()).optional(),
        }),
        readOnly: false,
        execute: async (deps, { title, markdown, folderId, tags }) => ({
            data: await writeTools.createNote(deps, { title, markdown, folderId, tags }),
            notes: liveBlockLayoutWarnings(markdown),
        }),
    }),
    defineTool({
        name: 'create_folder',
        title: 'Create folder',
        description: 'Create a Journal folder. This agent gets Read+write access to it, so it can create notes there.',
        input: z.object({ name: z.string() }),
        readOnly: false,
        execute: async (deps, { name }) => ({ data: await writeTools.createFolder(deps, { name }) }),
    }),
    defineTool({
        name: 'append_to_note',
        title: 'Append to note',
        description:
            'Append markdown to the end of a Journal note with Read+write access. Merges with concurrent edits.' + BODY_IMAGES + RICH_BLOCKS,
        input: z.object({ id: z.string(), markdown: z.string() }),
        readOnly: false,
        execute: async (deps, { id, markdown }) => ({
            data: await writeTools.appendToNote(deps, { id, markdown }),
            notes: liveBlockLayoutWarnings(markdown),
        }),
    }),
    defineTool({
        name: 'replace_in_note',
        title: 'Replace in note',
        description:
            "Replace one unique span of a Journal note's markdown (as returned by get_note) with new markdown. " +
            'old_text must match exactly once; include surrounding text if it is ambiguous.' +
            BODY_IMAGES.replace('Images:', 'Images in new_text:') +
            RICH_BLOCKS,
        input: z.object({ id: z.string(), old_text: z.string(), new_text: z.string() }),
        readOnly: false,
        execute: async (deps, { id, old_text, new_text }) => ({
            data: await writeTools.replaceInNote(deps, { id, old_text, new_text }),
            notes: liveBlockLayoutWarnings(new_text),
        }),
    }),
    defineTool({
        name: 'update_note',
        title: 'Update note',
        description:
            "Rewrite a Journal note with Read+write access: its whole body as markdown, its title and/or its tags (tags replace the note's tags). " +
            'Use it instead of creating a second note. Blocks you keep exactly as get_note returned them stay untouched, note links and images included. ' +
            "Pass get_note's `modified` as expectedModified to refuse the edit if the note changed since. Merges with concurrent edits." +
            BODY_IMAGES +
            RICH_BLOCKS,
        input: z.object({
            id: z.string(),
            markdown: z.string().optional(),
            title: z.string().optional(),
            tags: z.array(z.string()).optional(),
            expectedModified: z.string().optional(),
        }),
        readOnly: false,
        execute: async (deps, { id, markdown, title, tags, expectedModified }) => ({
            data: await writeTools.updateNote(deps, { id, markdown, title, tags, expectedModified }),
            notes: liveBlockLayoutWarnings(markdown ?? ''),
        }),
    }),
    defineTool({
        name: 'edit_block',
        title: 'Edit block',
        description:
            'Edit one block of a Journal note with Read+write access, by its id from get_note with format "blocks". Every other block is left as it is, and the edit merges with concurrent edits. ' +
            'op.type: replace, insert_before or insert_after (markdown); delete; set_text (a callout\'s or toggle\'s body, keeping its variant or summary); ' +
            'set_attrs (attrs: callout variant, toggle summary, heading level, code block language, id and wide, task list checked); ' +
            'and for a table, set_cell (row, col, markdown), insert_row (at, cells?), delete_row, insert_column and delete_column (at), which keep column widths and the other cells. ' +
            'Returns the ids of the blocks the op leaves. Pass get_note\'s `modified` as expectedModified to refuse the edit if the note changed since.' +
            BODY_IMAGES.replace('Images:', 'Images in markdown:') +
            RICH_BLOCKS,
        input: z.object({
            note_id: z.string(),
            block_id: z.string(),
            op: z.discriminatedUnion('type', [
                z.object({ type: z.enum(['replace', 'insert_before', 'insert_after', 'set_text']), markdown: z.string() }),
                z.object({ type: z.literal('delete') }),
                z.object({
                    type: z.literal('set_attrs'),
                    attrs: z.object({
                        variant: z.enum(CALLOUT_VARIANTS).optional(),
                        summary: z.string().optional(),
                        level: z.number().int().min(1).max(6).optional(),
                        language: z.string().nullable().optional(),
                        id: z.string().nullable().optional(),
                        wide: z.boolean().optional(),
                        checked: z.array(z.boolean()).optional(),
                    }),
                }),
                z.object({ type: z.literal('set_cell'), row: index, col: index, markdown: z.string() }),
                z.object({ type: z.literal('insert_row'), at: index, cells: z.array(z.string()).optional() }),
                z.object({ type: z.enum(['delete_row', 'insert_column', 'delete_column']), at: index }),
            ]),
            expectedModified: z.string().optional(),
        }),
        readOnly: false,
        execute: async (deps, { note_id, block_id, op, expectedModified }) => ({
            data: await writeTools.editBlock(deps, { note_id, block_id, op, expectedModified }),
            notes: liveBlockLayoutWarnings('markdown' in op ? op.markdown : op.type === 'insert_row' ? (op.cells ?? []).join('\n\n') : ''),
        }),
    }),
    defineTool({
        name: 'delete_note',
        title: 'Delete note',
        description: "Move a Journal note with Read+write access to Journal's Trash, where the owner can restore it. Never deletes permanently.",
        input: z.object({ id: z.string() }),
        readOnly: false,
        execute: async (deps, { id }) => ({ data: await writeTools.deleteNote(deps, { id }) }),
    }),
    defineTool({
        name: 'set_note_cover',
        title: 'Set note cover',
        description:
            "Set the cover image of a Journal note with Read+write access, replacing its cover. `image` is an absolute path to a file on this computer (preferred: it costs no tokens) or a base64 `data:` URI. " +
            'PNG, JPEG or WebP, at most 5 MB; metadata such as EXIF and GPS is removed before upload. Recommended size 2400×1260, at least 1200×630. ' +
            'The image is uploaded as is (not resized): crop it to about 1.9:1 and resize it to 2400×1260 first; the result has a `note` when it is too small or the wrong shape. ' +
            '`positionY` is the vertical focal point, 0 (top) to 100 (bottom), default 50. ' +
            "`dark: true` sets the cover shown in dark mode instead; the note must already have a cover. " +
            'Use this rather than an image in an html block: the cover also feeds the link preview of a public note.',
        input: z.object({
            id: z.string(),
            image: z.string(),
            positionY: z.number().min(0).max(100).optional(),
            dark: z.boolean().optional(),
        }),
        readOnly: false,
        execute: async (deps, { id, image, positionY, dark }) => ({ data: await writeTools.setNoteCover(deps, { id, image, positionY, dark }) }),
    }),
    defineTool({
        name: 'clear_note_cover',
        title: 'Clear note cover',
        description:
            'Remove the cover image of a Journal note with Read+write access. This removes the dark-mode cover too; ' +
            'with `dark: true` only the dark-mode cover is removed.',
        input: z.object({ id: z.string(), dark: z.boolean().optional() }),
        readOnly: false,
        execute: async (deps, { id, dark }) => ({ data: await writeTools.clearNoteCover(deps, { id, dark }) }),
    }),
];
