/**
 * Leader side of PGlite's multi-tab worker — the `worker()` entry point.
 *
 * Adapted from @electric-sql/pglite 0.5.8, src/worker/index.ts (`worker`,
 * `connectTab`, `makeWorkerApi`, `acquireLock`).
 * Copyright ElectricSQL; licensed under the Apache License, Version 2.0
 * (http://www.apache.org/licenses/LICENSE-2.0). Modified as listed below.
 *
 * ponytail: this file exists only until the upstream fix lands — then delete it
 * and import `worker` from '@electric-sql/pglite/worker' again. Upstream issue:
 * TODO(upstream-issue-url). The drift guard in
 * src/__tests__/pgliteWorkerHost.test.ts fails on any pglite version bump.
 *
 * Changes from upstream (everything else is kept as-is, so a diff shows them):
 *   1. A tab's query or transaction lock that is granted after the tab has
 *      closed is released at once. Upstream stores the release for a tab whose
 *      close handler has already run, so the lock is never released and every
 *      tab's queries hang until the leader tab goes away.
 *   2. The tab-close handler marks the tab closed (`tabClosed`), which is what
 *      change 1 checks.
 *   3. No RPC reply is posted to a closed tab's channel. Upstream throws an
 *      unhandled InvalidStateError there.
 */
import type { PGlite } from '@electric-sql/pglite';
import type { PGliteWorkerOptions, WorkerOptions } from '@electric-sql/pglite/worker';

export const ADAPTED_FROM_PGLITE_VERSION = '0.5.8';

export async function worker({ init }: WorkerOptions) {
  // Send a message to the main thread to let it know we are here
  postMessage({ type: 'here' });

  // Await the main thread to send us the options
  const options = await new Promise<Exclude<PGliteWorkerOptions, 'extensions'>>((resolve) => {
    addEventListener(
      'message',
      (event) => {
        if (event.data.type === 'init') {
          resolve(event.data.options);
        }
      },
      { once: true },
    );
  });

  // ID for this multi-tab worker - this is used to identify the group of workers
  // that are trying to elect a leader for a shared PGlite instance.
  const id = options.id ?? `${import.meta.url}:${options.dataDir ?? ''}`;

  // Let the main thread know we are ready
  postMessage({ type: 'ready', id });

  const electionLockId = `pglite-election-lock:${id}`;
  const broadcastChannelId = `pglite-broadcast:${id}`;
  const broadcastChannel = new BroadcastChannel(broadcastChannelId);
  const connectedTabs = new Set<string>();

  // Await the main lock which is used to elect the leader
  // We don't release this lock, its automatically released when the worker or
  // tab is closed
  await acquireLock(electionLockId);

  // Now we are the leader, start the worker
  const dbPromise = init(options);

  // Start listening for messages from tabs
  broadcastChannel.onmessage = async (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'tab-here':
        // A new tab has joined,
        connectTab(msg.id, await dbPromise, connectedTabs);
        break;
    }
  };

  // Notify the other tabs that we are the leader
  broadcastChannel.postMessage({ type: 'leader-here', id });

  // Let the main thread know we are the leader
  postMessage({ type: 'leader-now' });

  const db = await dbPromise;

  // Listen for notifications and broadcast them to all tabs
  db.onNotification((channel, payload) => {
    broadcastChannel.postMessage({ type: 'notify', channel, payload });
  });
}

function connectTab(tabId: string, pg: PGlite, connectedTabs: Set<string>) {
  if (connectedTabs.has(tabId)) {
    return;
  }
  connectedTabs.add(tabId);
  const tabChannelId = `pglite-tab:${tabId}`;
  const tabCloseLockId = `pglite-tab-close:${tabId}`;
  const tabChannel = new BroadcastChannel(tabChannelId);
  // Change 3: set once the tab closes, so late replies are dropped.
  let channelClosed = false;

  // Use a tab close lock to unsubscribe the tab
  navigator.locks.request(tabCloseLockId, () => {
    return new Promise<void>((resolve) => {
      // The tab has been closed, unsubscribe the tab broadcast channel
      channelClosed = true;
      tabChannel.close();
      connectedTabs.delete(tabId);
      resolve();
    });
  });

  const api = makeWorkerApi(tabId, pg);

  tabChannel.addEventListener('message', async (event) => {
    const msg = event.data;
    switch (msg.type) {
      case 'rpc-call': {
        await pg.waitReady;
        const { callId, method, args } = msg as { callId: string; method: keyof WorkerApi; args: unknown[] };
        try {
          const result = await (api[method] as (...a: unknown[]) => Promise<unknown>)(...args);
          if (!channelClosed) tabChannel.postMessage({ type: 'rpc-return', callId, result });
        } catch (error) {
          console.error(error);
          if (!channelClosed) {
            tabChannel.postMessage({ type: 'rpc-error', callId, error: { message: (error as Error).message } });
          }
        }
        break;
      }
    }
  });

  // Send a message to the tab to let it know it's connected
  tabChannel.postMessage({ type: 'connected' });
}

function makeWorkerApi(tabId: string, db: PGlite) {
  let queryLockRelease: (() => void) | null = null;
  let transactionLockRelease: (() => void) | null = null;
  // Change 2: a lock granted after this is set has no tab left to release it.
  let tabClosed = false;

  // If the tab is closed and it is holding a lock, release the the locks
  // and rollback any pending transactions
  const tabCloseLockId = `pglite-tab-close:${tabId}`;
  acquireLock(tabCloseLockId).then(() => {
    tabClosed = true;
    if (transactionLockRelease) {
      // rollback any pending transactions
      db.exec('ROLLBACK');
    }
    queryLockRelease?.();
    transactionLockRelease?.();
  });

  return {
    async getDebugLevel() {
      return db.debug;
    },
    async close() {
      await db.close();
    },
    async execProtocol(message: Uint8Array) {
      const { messages, data } = await db.execProtocol(message);
      if (data.byteLength !== data.buffer.byteLength) {
        const buffer = new ArrayBuffer(data.byteLength);
        const dataCopy = new Uint8Array(buffer);
        dataCopy.set(data);
        return { messages, data: dataCopy };
      } else {
        return { messages, data };
      }
    },
    async execProtocolStream(message: Uint8Array) {
      const messages = await db.execProtocolStream(message);
      return messages;
    },
    async execProtocolRawStream(message: Uint8Array, options: Parameters<PGlite['execProtocolRawStream']>[1]) {
      const messages = await db.execProtocolRawStream(message, options);
      return messages;
    },
    async execProtocolRaw(message: Uint8Array) {
      const result = await db.execProtocolRaw(message);
      if (result.byteLength !== result.buffer.byteLength) {
        // The data is a slice of a larger buffer, this is potentially the whole
        // memory of the WASM module. We copy it to a new Uint8Array and return that.
        const buffer = new ArrayBuffer(result.byteLength);
        const resultCopy = new Uint8Array(buffer);
        resultCopy.set(result);
        return resultCopy;
      } else {
        return result;
      }
    },
    async dumpDataDir(compression?: Parameters<PGlite['dumpDataDir']>[0]) {
      return await db.dumpDataDir(compression);
    },
    async syncToFs() {
      return await db.syncToFs();
    },
    async _handleBlob(blob?: File | Blob) {
      return await db._handleBlob(blob);
    },
    async _getWrittenBlob() {
      return await db._getWrittenBlob();
    },
    async _cleanupBlob() {
      return await db._cleanupBlob();
    },
    async _checkReady() {
      return await db._checkReady();
    },
    async _acquireQueryLock() {
      return new Promise<void>((resolve) => {
        db._runExclusiveQuery(() => {
          return new Promise<void>((release) => {
            // Change 1: the tab closed while this request was queued.
            if (tabClosed) return release();
            queryLockRelease = release;
            resolve();
          });
        });
      });
    },
    async _releaseQueryLock() {
      queryLockRelease?.();
      queryLockRelease = null;
    },
    async _acquireTransactionLock() {
      return new Promise<void>((resolve) => {
        db._runExclusiveTransaction(() => {
          return new Promise<void>((release) => {
            // Change 1: the tab closed while this request was queued.
            if (tabClosed) return release();
            transactionLockRelease = release;
            resolve();
          });
        });
      });
    },
    async _releaseTransactionLock() {
      transactionLockRelease?.();
      transactionLockRelease = null;
    },
  };
}

type WorkerApi = ReturnType<typeof makeWorkerApi>;

async function acquireLock(lockId: string) {
  let release: (() => void) | undefined;
  await new Promise<void>((resolve) => {
    navigator.locks.request(lockId, () => {
      return new Promise<void>((releaseCallback) => {
        release = releaseCallback;
        resolve();
      });
    });
  });
  return release;
}
