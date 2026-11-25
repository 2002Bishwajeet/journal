/**
 * The sandbox half of run_script (mcp/runScript.ts): the script runs in QuickJS compiled to
 * WebAssembly, a fresh instance per run. It has no fs, network, process, timers or module
 * loader; its only ways out are `console.log` and the `journal` functions, both through `host`.
 * Imports nothing but QuickJS, so the hosted server's worker (mcp/hosted/scripts.ts) can run it
 * off the main thread. Node `vm` is not a security boundary, which is why this isn't it.
 *
 * The functions return promises, settled from the host between QuickJS job runs, so a
 * script can `await` them anywhere (asyncify can't suspend inside a promise job).
 */
import { newQuickJSWASMModuleFromVariant, type QuickJSDeferredPromise, type QuickJSHandle } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-mjs-release-sync';

/** What the sandbox sees of the host. */
export interface GuestHost {
    /** A `journal` function: its result as JSON text, or a rejection with the message the script sees. */
    call(name: string, argsJson: string): Promise<string>;
    log(line: string): void;
    /** Why the run ended, once it has: a limit the host hit, or `fail`'s text. */
    error(): string | undefined;
    /** Ends the run with `text`, unless it already ended. */
    fail(text: string): void;
}

export interface GuestOptions {
    cpuMs: number;
    memoryBytes: number;
    /** The `journal` function names, each a `host.call`. */
    api: string[];
}

/** Runs `code` against `host`, returning once the run ended and every call it started settled. */
export type ScriptGuest = (code: string, host: GuestHost, options: GuestOptions) => Promise<void>;

/**
 * Runs in the isolate before the script: builds `journal` and `console` over the two host
 * functions, then removes those from the global. Returns the error formatter.
 */
const prelude = (api: string[]) => `(() => {
    const call = globalThis.__call, log = globalThis.__log;
    delete globalThis.__call;
    delete globalThis.__log;
    const { parse, stringify } = JSON;
    const api = {};
    for (const name of ${JSON.stringify(api)}) api[name] = (...args) => call(name, stringify(args)).then(parse);
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

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The sandbox on this thread: what the stdio server uses, and what the hosted worker runs. */
export const runGuest: ScriptGuest = async (code, host, limits) => {
    const runtime = (await newQuickJSWASMModuleFromVariant(variant)).newRuntime();
    runtime.setMemoryLimit(limits.memoryBytes);
    runtime.setMaxStackSize(512 * 1024);
    // CPU time is the time spent inside QuickJS; awaiting the drive doesn't count.
    let cpuMs = 0;
    let sliceStart = 0;
    const overCpu = () => cpuMs + (performance.now() - sliceStart) > limits.cpuMs;
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
        const task = host
            .call(ctx.getString(nameHandle), ctx.getString(argsHandle))
            .then(
                (json) => settle(deferred, true, json),
                (err) => settle(deferred, false, message(err))
            )
            // A failed settle (the isolate out of memory) leaves the promise pending; the run then ends.
            .catch(() => undefined)
            .finally(() => inFlight.delete(task));
        inFlight.add(task);
        return deferred.handle;
    });
    const logFn = ctx.newFunction('log', (line) => {
        host.log(ctx.getString(line));
    });
    ctx.setProp(ctx.global, '__call', callFn);
    ctx.setProp(ctx.global, '__log', logFn);
    callFn.dispose();
    logFn.dispose();
    const describe = ctx.unwrapResult(inGuest(() => ctx.evalCode(prelude(limits.api), 'prelude.js')));

    const errorText = (handle: QuickJSHandle): string => {
        if (overCpu()) return `Script stopped: it used more than ${limits.cpuMs / 1000} s of CPU time.`;
        // Room to format the error after running out of memory.
        runtime.setMemoryLimit(limits.memoryBytes + 4 * 1024 * 1024);
        const result = inGuest(() => ctx.callFunction(describe, ctx.undefined, handle));
        const text = result.error ? 'out of memory' : ctx.getString(result.value);
        result.dispose();
        if (/out of memory/i.test(text)) return `Script stopped: it used more than ${limits.memoryBytes / 1024 / 1024} MB of memory.`;
        return text.slice(0, 1000);
    };

    /** Ends the run with the error `handle` holds, unless a limit ended it first. */
    const fail = (handle: QuickJSHandle) => {
        if (!host.error()) host.fail(errorText(handle));
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
                if (host.error()) break;
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
                    host.fail('Script stopped: it awaited a promise that never settles.');
                    break;
                }
                await Promise.race(inFlight);
            }
            promise.dispose();
        }
    } finally {
        // Calls the script didn't await still finish before the run returns.
        await Promise.all(inFlight);
        describe.dispose();
        ctx.dispose();
        runtime.dispose();
    }
};
