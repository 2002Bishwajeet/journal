/**
 * Which build a service worker was made from, or undefined when it doesn't answer in time
 * (a worker from before it could answer, or one that never starts). sw.ts answers GET_BUILD on the port.
 */
export function askServiceWorkerBuild(sw: ServiceWorker, timeoutMs = 3000): Promise<string | undefined> {
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => resolve(undefined), timeoutMs);
        channel.port1.onmessage = (event) => {
            clearTimeout(timer);
            resolve(typeof event.data === 'string' ? event.data : undefined);
        };
        sw.postMessage({ type: 'GET_BUILD' }, [channel.port2]);
    });
}

/**
 * The root navigation goes to the network first (sw.ts), so a launch after a deploy already runs
 * the new bundle while the new worker still waits behind the old one. A waiting worker from the
 * build this page runs is no update: it only has to take over.
 */
export async function isRunningBuild(sw: ServiceWorker | null | undefined): Promise<boolean> {
    return !!sw && (await askServiceWorkerBuild(sw)) === __APP_BUILD__;
}
