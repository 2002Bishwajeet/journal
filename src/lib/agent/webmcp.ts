/**
 * Registers Journal's agent tools with the browser's WebMCP API (#705), so the browser's own
 * agent can list, search and read the notes the user granted, and propose edits to the open
 * note. Loaded by dynamic import, only when the browser has WebMCP and the user turned it on.
 *
 * The browser's agent may be a cloud model, so access is the user's Agent access grants
 * (`deps.loadGrants`), never the in-app agent's all-notes access. An edit tool resolves after
 * the user accepts or rejects the preview in the note (#701).
 */
import type { z } from 'zod';
import { TOOLS, toJsonSchema, type AnyJournalTool } from '@/lib/agent/tools/registry';
import { formatText, insertParagraph, readOpenNote, replaceText, setBlockType, type EditorTool } from '@/lib/agent/tools/editor';
import { noteAccess, type ReadDeps } from '@/lib/agent/tools/read';
import type { WriteDeps } from '@/lib/agent/tools/write';
import { activeEditor, type ActiveEditorStore } from '@/lib/agent/activeEditor';
import { approveEdit, type BuiltEdit, type EditOutcome } from '@/lib/agent/approveEdit';
import type { ModelContext, WebMcpTool } from './modelContext';

export interface WebMcpOptions {
    modelContext: ModelContext;
    /** Local deps whose `loadGrants` returns the user's real Agent access grants. */
    deps: ReadDeps;
    editor?: ActiveEditorStore;
    approve?: typeof approveEdit;
}

export interface WebMcpHandle {
    /** Registers or unregisters the open-note tools to match the open note's grant. */
    sync(): Promise<void>;
    /** Aborts every registration. */
    stop(): void;
}

type ToolSpec = Pick<AnyJournalTool, 'name' | 'description' | 'input' | 'readOnly'>;

const NOTE_TOOL_NAMES = ['list_folders', 'list_notes', 'search_notes', 'get_note'];

// get_note's "blocks" format reads through WriteDeps, which the browser has no use for.
const noteTools: AnyJournalTool[] = NOTE_TOOL_NAMES.map((name) => {
    const tool = TOOLS.find((t) => t.name === name)!;
    if (name !== 'get_note') return tool;
    return { ...tool, description: 'Fetch one granted Journal note by id, with its body as markdown.', input: tool.input.pick({ id: true }) };
});

const openNoteTools: EditorTool[] = [readOpenNote, insertParagraph, setBlockType, replaceText, formatText];

/** Arguments arrive as an object, or as a JSON string (deprecated in Chrome 155). */
function parseArgs(tool: ToolSpec, raw: unknown): z.infer<typeof tool.input> {
    let value = raw;
    if (typeof raw === 'string') {
        try {
            value = raw.trim() ? JSON.parse(raw) : {};
        } catch {
            throw new Error(`Arguments for ${tool.name} must be a JSON object.`);
        }
    }
    const parsed = tool.input.safeParse(value ?? {});
    if (!parsed.success) {
        throw new Error(`Invalid arguments for ${tool.name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ')}`);
    }
    return parsed.data;
}

function toWebMcpTool(tool: ToolSpec, run: (args: never, signal?: AbortSignal) => Promise<unknown>): WebMcpTool {
    return {
        name: tool.name,
        description: tool.description,
        inputSchema: toJsonSchema(tool),
        // Note text can carry instructions meant for the agent.
        annotations: { readOnlyHint: tool.readOnly, untrustedContentHint: true },
        execute: async (raw, options) => JSON.stringify(await run(parseArgs(tool, raw) as never, options?.signal)),
    };
}

const describeOutcome = (outcome: EditOutcome, summary: string) =>
    outcome === 'accepted'
        ? { outcome: 'accepted', summary }
        : outcome === 'rejected'
          ? { outcome: 'rejected by the user', summary }
          : { outcome: 'not applied', summary, reason: outcome.notApplied };

export async function startWebMcp({ modelContext, deps, editor = activeEditor, approve = approveEdit }: WebMcpOptions): Promise<WebMcpHandle> {
    const root = new AbortController();
    let openNoteRegistration: AbortController | null = null;
    let queue: Promise<void> = Promise.resolve();

    const register = (tools: WebMcpTool[], signal: AbortSignal) =>
        Promise.all(tools.map((tool) => modelContext.registerTool(tool, { signal })));

    /** The open note's access; 'none' unless a note is open, editable and granted. */
    async function openNoteAccess() {
        const open = editor.get();
        if (!open?.editable || open.excludeFromAI) return 'none';
        const [grants, notes] = await Promise.all([deps.loadGrants(), deps.listNotes()]);
        const note = notes.find((n) => n.id === open.docId);
        return note ? noteAccess(grants, note) : 'none';
    }

    async function runOpenNoteTool(tool: EditorTool, args: never, signal?: AbortSignal) {
        // Checked again on every call: the grant or the open note may have changed since registering.
        if ((await openNoteAccess()) !== 'write') throw new Error('The open note is not granted for editing.');
        const run = () => tool.execute(editor, args);
        const first = await run();
        if (tool.readOnly) return first.data;
        // The tool only built the edit; the user previews it in the note and answers there.
        const built = first.data as BuiltEdit;
        const rebuild = async () => (await run()).data as BuiltEdit;
        return describeOutcome(await approve({ edit: { built, rebuild } }, signal), built.summary);
    }

    const sync = () =>
        (queue = queue
            .then(async () => {
                if (root.signal.aborted) return;
                const writable = (await openNoteAccess()) === 'write';
                if (root.signal.aborted || writable === (openNoteRegistration !== null)) return;
                if (!writable) {
                    openNoteRegistration?.abort();
                    openNoteRegistration = null;
                    return;
                }
                const registration = new AbortController();
                openNoteRegistration = registration;
                root.signal.addEventListener('abort', () => registration.abort(), { once: true });
                await register(openNoteTools.map((tool) => toWebMcpTool(tool, (args, signal) => runOpenNoteTool(tool, args, signal))), registration.signal);
            })
            .catch((error) => console.error('WebMCP: could not update the open-note tools.', error)));

    await register(
        noteTools.map((tool) => toWebMcpTool(tool, async (args) => (await tool.execute(deps as WriteDeps, args)).data)),
        root.signal
    );
    const unsubscribe = editor.subscribe(() => void sync());
    await sync();

    return {
        sync,
        stop() {
            unsubscribe();
            root.abort();
        },
    };
}
