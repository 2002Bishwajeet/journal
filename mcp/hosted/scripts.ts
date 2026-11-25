import { Worker } from 'node:worker_threads';
import type { ScriptGuest } from '../scriptGuest';
import type { ToHost, ToWorker } from './scriptWorker';

// run_script on the hosted server (#1505): one event loop serves every user, so the sandbox runs on a
// worker thread, killed outright at the wall-clock limit, with at most one run per user and a few in all.

export const HOSTED_SCRIPT_LIMITS = { cpuMs: 3_000, wallMs: 20_000, perUser: 1, total: 2 };

export const SCRIPTS_BUSY = 'Journal is running as many scripts as it can right now. Try again in a few seconds.';
export const SCRIPT_RUNNING = 'Another of your scripts is still running. Wait for it to finish, then try again.';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The sandbox in a worker started on `workerUrl` (the hosted bundle itself, or a test's build of
 * scriptWorker.ts). CPU time is capped at `cpuMs` inside it; past `wallMs` the worker is terminated.
 */
export function workerGuest(workerUrl: URL, { cpuMs, wallMs } = HOSTED_SCRIPT_LIMITS): ScriptGuest {
    return (code, host, options) =>
        new Promise<void>((resolve) => {
            const worker = new Worker(workerUrl, { workerData: { code, options: { ...options, cpuMs: Math.min(options.cpuMs, cpuMs) } } });
            const pending = new Set<Promise<void>>();
            let finished = false;
            const finish = (failure?: string) => {
                if (finished) return;
                finished = true;
                if (failure) host.fail(failure);
                clearTimeout(timer);
                void worker.terminate();
                // Calls already running on the drive still finish before the run returns.
                void Promise.all(pending).then(() => resolve());
            };
            const timer = setTimeout(() => finish(`Script stopped: it ran for more than ${wallMs / 1000} s.`), wallMs);

            worker.on('message', (m: ToHost) => {
                if (finished) return;
                if (m.type === 'log') host.log(m.line);
                else if (m.type === 'fail') host.fail(m.text);
                else if (m.type === 'done') finish();
                else {
                    const task = host
                        .call(m.name, m.args)
                        .then(
                            (text): ToWorker => ({ id: m.id, ok: true, text }),
                            (e): ToWorker => ({ id: m.id, ok: false, text: message(e) })
                        )
                        .then((reply) => {
                            // A limit the host hit ends the run here: the worker never has to see it.
                            if (host.error()) finish();
                            else if (!finished) worker.postMessage(reply);
                        })
                        .finally(() => pending.delete(task));
                    pending.add(task);
                }
            });
            // An uncaught error in the worker is followed by its exit.
            worker.on('error', () => undefined);
            worker.on('exit', () => finish('Script stopped: the sandbox failed.'));
        });
}

/** Admits a run when its user has none going and there is room; otherwise throws, for the tool's error. */
export function scriptSlots({ perUser, total } = HOSTED_SCRIPT_LIMITS) {
    const running = new Map<string, number>();
    let all = 0;
    return async function admit<T>(user: string, run: () => Promise<T>): Promise<T> {
        const mine = running.get(user) ?? 0;
        if (mine >= perUser) throw new Error(SCRIPT_RUNNING);
        if (all >= total) throw new Error(SCRIPTS_BUSY);
        running.set(user, mine + 1);
        all++;
        try {
            return await run();
        } finally {
            all--;
            const left = running.get(user)! - 1;
            if (left) running.set(user, left);
            else running.delete(user);
        }
    };
}
