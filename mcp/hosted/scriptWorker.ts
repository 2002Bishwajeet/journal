import { parentPort, workerData } from 'node:worker_threads';
import { runGuest, type GuestOptions } from '../scriptGuest';

// run_script's sandbox on a worker thread (#1505), started by mcp/hosted/scripts.ts: the hosted
// bundle runs this module when it isn't the main thread (mcp/hosted/main.ts). Every `journal` call
// and log line is a message to the main thread, which holds the drive and the run's limits.

export type ToHost = { type: 'call'; id: number; name: string; args: string } | { type: 'log'; line: string } | { type: 'fail'; text: string } | { type: 'done' };
export type ToWorker = { id: number; ok: boolean; text: string };

const port = parentPort!;
const { code, options } = workerData as { code: string; options: GuestOptions };
const send = (message: ToHost) => port.postMessage(message);
const waiting = new Map<number, { resolve(text: string): void; reject(error: Error): void }>();
let nextId = 0;
let failed: string | undefined;

port.on('message', ({ id, ok, text }: ToWorker) => {
    const call = waiting.get(id);
    waiting.delete(id);
    if (ok) call?.resolve(text);
    else call?.reject(new Error(text));
});

await runGuest(
    code,
    {
        call: (name, args) =>
            new Promise((resolve, reject) => {
                const id = nextId++;
                waiting.set(id, { resolve, reject });
                send({ type: 'call', id, name, args });
            }),
        log: (line) => send({ type: 'log', line }),
        error: () => failed,
        fail: (text) => {
            failed ??= text;
            send({ type: 'fail', text });
        },
    },
    options
);
send({ type: 'done' });
