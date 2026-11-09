/**
 * run_script (#1005): agent-written JavaScript run against the notes API, so a job that
 * picks notes by their content returns only what the script logs, not every body.
 *
 * The script runs in QuickJS compiled to WebAssembly, a fresh instance per run. It has no
 * fs, network, process, timers or module loader; its only ways out are `console.log` and
 * the `journal` functions below, which call the same tool handlers as the MCP tools, so
 * grants, link and URL checks apply as they do there. Scripts can't trash notes (owner
 * decision on #1005) or upload images, so note text can't steer a script into reading a
 * local file. Node `vm` is not a security boundary, which is why this isn't it.
 *
 * The functions return promises, settled from the host between QuickJS job runs, so a
 * script can `await` them anywhere (asyncify can't suspend inside a promise job).
 */
import { newQuickJSWASMModuleFromVariant, type QuickJSDeferredPromise, type QuickJSHandle } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-mjs-release-sync';
import { z } from 'zod';
import { TOOLS, type AnyJournalTool } from '@/lib/agent/tools/registry';
import type { WriteDeps } from '@/lib/agent/tools/write';

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
    search: [tool('search_notes'), (query, limit) => ({ query, limit })],
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

/**
 * Runs in the isolate before the script: builds `journal` and `console` over the two host
 * functions, then removes those from the global. Returns the error formatter.
 */
const PRELUDE = `(() => {
    const call = globalThis.__call, log = globalThis.__log;
    delete globalThis.__call;
    delete globalThis.__log;
    const { parse, stringify } = JSON;
    const api = {};
    for (const name of ${JSON.stringify(SCRIPT_API)}) api[name] = (...args) => call(name, stringify(args)).then(parse);
    globalThis.journal = Object.freeze(api);
    const format = (value) => (typeof value === 'string' ? value : (stringify(value) ?? String(value)));
    const print = (...values) => log(values.map(format).join(' '));
    globalThis.console = Object.freeze({ log: print, info: print, warn: print, error: print });
    return (e) => {
        try {
            if (e instanceof Error) return String(e.name) + ': ' + String(e.message) + (e.stack ? '\\n' + String(e.stack).trim() : '');
            return 'Uncaught ' + format(e);
        } catch {
            return 'Uncaught a value that cannot be printed';
        }
    };
})()`;

export interface ScriptResult {
    /** What the script logged (and, in a dry run, each write it would make), capped. Note content: untrusted. */
    output: string;
    /** Why the script stopped early: its own error or a limit. Part of the output, so also untrusted. */
    error?: string;
    reads: number;
    writes: number;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runScript(deps: WriteDeps, code: string, dryRun = false): Promise<ScriptResult> {
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

    const runtime = (await newQuickJSWASMModuleFromVariant(variant)).newRuntime();
    runtime.setMemoryLimit(SCRIPT_LIMITS.memoryBytes);
    runtime.setMaxStackSize(512 * 1024);
    // CPU time is the time spent inside QuickJS; awaiting the drive doesn't count.
    let cpuMs = 0;
    let sliceStart = 0;
    const overCpu = () => cpuMs + (performance.now() - sliceStart) > SCRIPT_LIMITS.cpuMs;
    runtime.setInterruptHandler(overCpu);
    const inGuest = <T>(run: () => T): T => {
        sliceStart = performance.now();
        try {
            return run();
        } finally {
            cpuMs += performance.now() - sliceStart;
        }
    };

    const ctx = runtime.newContext();
    const inFlight = new Set<Promise<void>>();
    const settle = (deferred: QuickJSDeferredPromise, ok: boolean, text: string) => {
        inGuest(() => {
            const value = ok ? ctx.newString(text) : ctx.newError(text);
            if (ok) deferred.resolve(value);
            else deferred.reject(value);
            value.dispose();
        });
    };

    const callFn = ctx.newFunction('call', (nameHandle, argsHandle) => {
        const deferred = ctx.newPromise();
        const task = call(ctx.getString(nameHandle), ctx.getString(argsHandle))
            .then(
                (value) => settle(deferred, true, JSON.stringify(value ?? null)),
                (err) => settle(deferred, false, message(err))
            )
            // A failed settle (the isolate out of memory) leaves the promise pending; the run then ends.
            .catch(() => undefined)
            .finally(() => inFlight.delete(task));
        inFlight.add(task);
        return deferred.handle;
    });
    const logFn = ctx.newFunction('log', (line) => {
        print(ctx.getString(line));
    });
    ctx.setProp(ctx.global, '__call', callFn);
    ctx.setProp(ctx.global, '__log', logFn);
    callFn.dispose();
    logFn.dispose();
    const describe = ctx.unwrapResult(inGuest(() => ctx.evalCode(PRELUDE, 'prelude.js')));

    const errorText = (handle: QuickJSHandle): string => {
        if (overCpu()) return `Script stopped: it used more than ${SCRIPT_LIMITS.cpuMs / 1000} s of CPU time.`;
        // Room to format the error after running out of memory.
        runtime.setMemoryLimit(SCRIPT_LIMITS.memoryBytes + 4 * 1024 * 1024);
        const result = inGuest(() => ctx.callFunction(describe, ctx.undefined, handle));
        const text = result.error ? 'out of memory' : ctx.getString(result.value);
        result.dispose();
        if (/out of memory/i.test(text)) return `Script stopped: it used more than ${SCRIPT_LIMITS.memoryBytes / 1024 / 1024} MB of memory.`;
        return text.slice(0, 1000);
    };

    /** Ends the run with the error `handle` holds, unless a limit ended it first. */
    const fail = (handle: QuickJSHandle) => {
        error ??= errorText(handle);
        handle.dispose();
    };

    try {
        const started = inGuest(() => ctx.evalCode(`(async () => {\n${code}\n})()`, 'script.js'));
        if (started.error) fail(started.error);
        else {
            const promise = started.value;
            for (;;) {
                const jobs = inGuest(() => runtime.executePendingJobs());
                if (jobs.error) {
                    fail(jobs.error);
                    break;
                }
                if (error) break;
                const state = ctx.getPromiseState(promise);
                if (state.type === 'fulfilled') {
                    state.value.dispose();
                    break;
                }
                if (state.type === 'rejected') {
                    fail(state.error);
                    break;
                }
                if (inFlight.size === 0) {
                    error = 'Script stopped: it awaited a promise that never settles.';
                    break;
                }
                await Promise.race(inFlight);
            }
            promise.dispose();
        }
    } finally {
        // Calls the script didn't await still finish before the result is returned.
        await Promise.all(inFlight);
        describe.dispose();
        ctx.dispose();
        runtime.dispose();
    }

    let output = lines.join('\n');
    if (output.length > SCRIPT_LIMITS.outputChars) {
        output = `${output.slice(0, SCRIPT_LIMITS.outputChars)}\n[output cut at ${SCRIPT_LIMITS.outputChars} characters]`;
    }
    if (error) output += `${output ? '\n' : ''}${error}`;
    return { output, error, reads, writes };
}
