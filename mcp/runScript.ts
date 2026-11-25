/**
 * run_script (#1005): agent-written JavaScript run against the notes API, so a job that
 * picks notes by their content returns only what the script logs, not every body.
 *
 * The script runs in the QuickJS sandbox of mcp/scriptGuest.ts. Its `journal` functions,
 * below, call the same tool handlers as the MCP tools, so grants, link and URL checks apply
 * as they do there. Scripts can't trash notes (owner decision on #1005) or upload images,
 * so note text can't steer a script into reading a local file.
 */
import { z } from 'zod';
import { TOOLS, type AnyJournalTool } from '@/lib/agent/tools/registry';
import type { WriteDeps } from '@/lib/agent/tools/write';
import { runGuest, type ScriptGuest } from './scriptGuest';

export const SCRIPT_LIMITS = { cpuMs: 10_000, memoryBytes: 64 * 1024 * 1024, reads: 200, writes: 50, outputChars: 8_000 };

/** Each `journal` function: the tool it calls, and its arguments as that tool's input. */
type Binding = [tool: AnyJournalTool, input: (...args: unknown[]) => unknown];

function tool(name: string): AnyJournalTool {
    const found = TOOLS.find((t) => t.name === name);
    if (!found) throw new Error(`No tool ${name}`);
    return found;
}

const READS: Record<string, Binding> = {
    listNotes: [tool('list_notes'), (options = {}) => options],
    getNote: [tool('get_note'), (id) => ({ id })],
    outline: [tool('get_note'), (id) => ({ id, format: 'outline' })],
    search: [tool('search_notes'), (query, limitOrOptions) => ({ query, ...(typeof limitOrOptions === 'number' ? { limit: limitOrOptions } : (limitOrOptions as object | undefined)) })],
    listFolders: [tool('list_folders'), () => ({})],
};

const WRITES: Record<string, Binding> = {
    create: [tool('create_note'), (note) => note],
    update: [tool('update_note'), (changes) => changes],
    append: [tool('append_to_note'), (id, markdown) => ({ id, markdown })],
    replaceIn: [tool('replace_in_note'), (id, oldText, newText) => ({ id, old_text: oldText, new_text: newText })],
    editBlock: [tool('edit_block'), (noteId, blockId, op, expectedModified) => ({ note_id: noteId, block_id: blockId, op, expectedModified })],
    setTags: [tool('update_note'), (id, tags) => ({ id, tags })],
};

/** The `journal` function names, for the guide's `.d.ts` check. */
export const SCRIPT_API = [...Object.keys(READS), ...Object.keys(WRITES)];

/** Tool calls a script can have in flight at once, like search_notes' body fetches. */
const HOST_CONCURRENCY = 8;

const refuse = (what: string) => async (): Promise<never> => {
    throw new Error(`Scripts can't ${what}.`);
};

export interface ScriptResult {
    /** What the script logged (and, in a dry run, each write it would make), capped. Note content: untrusted. */
    output: string;
    /** Why the script stopped early: its own error or a limit. Part of the output, so also untrusted. */
    error?: string;
    reads: number;
    writes: number;
}

/** `guest` runs the sandbox: on this thread by default, in a worker on the hosted server (mcp/hosted/scripts.ts). */
export async function runScript(deps: WriteDeps, code: string, dryRun = false, guest: ScriptGuest = runGuest): Promise<ScriptResult> {
    const scriptDeps: WriteDeps = {
        ...deps,
        loadImage: refuse('add images from a file or a data: URI; add them with append_to_note or update_note'),
        trashNote: refuse('trash notes; use delete_note'),
    };

    const lines: string[] = [];
    let outputLength = 0;
    const print = (line: string) => {
        if (outputLength > SCRIPT_LIMITS.outputChars) return;
        lines.push(line);
        outputLength += line.length + 1;
    };

    let active = 0;
    const waiting: (() => void)[] = [];
    let reads = 0;
    let writes = 0;
    /** A limit the script hit, or the error it ended with; ends the run. */
    let error: string | undefined;

    const call = async (name: string, argsJson: string): Promise<unknown> => {
        const write = WRITES[name];
        const binding = write ?? READS[name];
        if (!binding) throw new Error(`journal.${name} is not a function`);
        if (write ? ++writes > SCRIPT_LIMITS.writes : ++reads > SCRIPT_LIMITS.reads) {
            error = `Script stopped: more than ${write ? `${SCRIPT_LIMITS.writes} writes` : `${SCRIPT_LIMITS.reads} reads`} in one run.`;
            throw new Error(error);
        }
        const [tool, toInput] = binding;
        const parsed = tool.input.safeParse(toInput(...(JSON.parse(argsJson) as unknown[])));
        if (!parsed.success) throw new Error(`journal.${name}: ${z.prettifyError(parsed.error)}`);
        if (write && dryRun) {
            print(`[dry run] ${name} ${JSON.stringify(parsed.data)}`);
            return { dryRun: true };
        }
        // At most HOST_CONCURRENCY tool calls at once, however many the script starts.
        while (active >= HOST_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
        // A call still queued when the run ends early is dropped, waking the next one.
        if (error) {
            waiting.shift()?.();
            throw new Error(error);
        }
        active++;
        try {
            return (await tool.execute(scriptDeps, parsed.data)).data;
        } finally {
            active--;
            waiting.shift()?.();
        }
    };

    await guest(
        code,
        {
            call: (name, argsJson) => call(name, argsJson).then((value) => JSON.stringify(value ?? null)),
            log: print,
            error: () => error,
            fail: (text) => void (error ??= text),
        },
        { cpuMs: SCRIPT_LIMITS.cpuMs, memoryBytes: SCRIPT_LIMITS.memoryBytes, api: SCRIPT_API }
    );

    let output = lines.join('\n');
    if (output.length > SCRIPT_LIMITS.outputChars) {
        output = `${output.slice(0, SCRIPT_LIMITS.outputChars)}\n[output cut at ${SCRIPT_LIMITS.outputChars} characters]`;
    }
    if (error) output += `${output ? '\n' : ''}${error}`;
    return { output, error, reads, writes };
}
