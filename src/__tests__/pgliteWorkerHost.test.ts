import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { worker, ADAPTED_FROM_PGLITE_VERSION } from '@/lib/db/pgliteWorkerHost';

// The leader side of PGlite's multi-tab worker, driven in-process: the test
// plays the follower tabs over real BroadcastChannels, with a FIFO Web Locks
// stand-in (Node has no navigator.locks).

class FakeLocks {
  private held = new Set<string>();
  private queues = new Map<string, Array<() => void>>();

  request<T>(name: string, callback: () => Promise<T> | T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        this.held.add(name);
        try {
          resolve(await callback());
        } catch (err) {
          reject(err);
        } finally {
          this.held.delete(name);
          this.queues.get(name)?.shift()?.();
        }
      };
      const queue = this.queues.get(name) ?? [];
      this.queues.set(name, queue);
      if (this.held.has(name) || queue.length > 0) queue.push(() => void run());
      else void run();
    });
  }
}

const ID = 'host-test';
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));
const channels: BroadcastChannel[] = [];

interface Tab {
  rpc: (method: string, ...args: unknown[]) => Promise<unknown>;
  close: () => void;
}

// What PGliteWorker does on the client: hold its tab-close lock for its
// lifetime, announce itself until the leader connects it, then RPC.
async function openTab(locks: FakeLocks, tabId: string): Promise<Tab> {
  let releaseCloseLock!: () => void;
  await new Promise<void>((held) => {
    void locks.request(`pglite-tab-close:${tabId}`, () => new Promise<void>((release) => {
      releaseCloseLock = release;
      held();
    }));
  });
  const tabChannel = new BroadcastChannel(`pglite-tab:${tabId}`);
  const broadcast = new BroadcastChannel(`pglite-broadcast:${ID}`);
  channels.push(tabChannel, broadcast);

  const connected = new Promise<void>((resolve) => {
    tabChannel.addEventListener('message', (event) => {
      if ((event as MessageEvent).data.type === 'connected') resolve();
    });
  });
  const announce = setInterval(() => broadcast.postMessage({ type: 'tab-here', id: tabId }), 16);
  await connected;
  clearInterval(announce);

  let nextCall = 0;
  return {
    rpc: (method, ...args) => {
      const callId = `${tabId}-${nextCall++}`;
      return new Promise((resolve, reject) => {
        tabChannel.addEventListener('message', (event) => {
          const msg = (event as MessageEvent).data;
          if (msg.callId !== callId) return;
          if (msg.type === 'rpc-return') resolve(msg.result);
          else reject(new Error(msg.error?.message));
        });
        tabChannel.postMessage({ type: 'rpc-call', callId, method, args });
      });
    },
    close: () => {
      tabChannel.close();
      broadcast.close();
      releaseCloseLock();
    },
  };
}

function withinMs<T>(promise: Promise<T>, ms: number): Promise<T | 'timed out'> {
  return Promise.race([promise, new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), ms))]);
}

describe('pgliteWorkerHost', () => {
  let locks: FakeLocks;
  let db: PGlite;

  beforeEach(() => {
    locks = new FakeLocks();
    vi.stubGlobal('navigator', { locks });
    vi.stubGlobal('postMessage', () => {});
    // The worker waits for the client's init message; deliver it at once.
    vi.stubGlobal('addEventListener', (_type: string, listener: (event: { data: unknown }) => void) => {
      listener({ data: { type: 'init', options: { id: ID } } });
    });
    db = new PGlite();
    void worker({ init: async () => db });
  });

  afterEach(async () => {
    for (const channel of channels.splice(0)) channel.close();
    vi.unstubAllGlobals();
    await db.close();
  });

  // A follower that closes while its lock request is queued behind another
  // tab's: the grant arrives after the tab is gone, and nothing is left to
  // release it, so every tab's next query waits forever (#156 e2e hang).
  it.each(['Query', 'Transaction'])(
    'releases a %s lock granted to a tab that closed while it was queued',
    async (kind) => {
      const holder = await openTab(locks, 'holder');
      await holder.rpc(`_acquire${kind}Lock`);

      const leaving = await openTab(locks, 'leaving');
      void leaving.rpc(`_acquire${kind}Lock`);
      await tick(); // queued in the leader behind the holder
      leaving.close();
      await tick(); // the leader has seen the tab close

      await holder.rpc(`_release${kind}Lock`); // the closed tab's grant fires now

      const next = await openTab(locks, 'next');
      expect(await withinMs(next.rpc(`_acquire${kind}Lock`), 2_000)).not.toBe('timed out');
      await next.rpc(`_release${kind}Lock`);
    },
  );

  it('still serves queries from other tabs after one closes', async () => {
    const tab = await openTab(locks, 'a');
    await tab.rpc('_acquireQueryLock');
    await tab.rpc('_releaseQueryLock');
    tab.close();
    const other = await openTab(locks, 'b');
    expect(await withinMs(other.rpc('_acquireQueryLock'), 2_000)).not.toBe('timed out');
  });
});

describe('pgliteWorkerHost drift guard', () => {
  it('is adapted from the installed @electric-sql/pglite version', () => {
    const installed = JSON.parse(
      readFileSync(new URL('../../node_modules/@electric-sql/pglite/package.json', import.meta.url), 'utf8'),
    ).version;
    expect(
      installed,
      `@electric-sql/pglite is now ${installed}, but src/lib/db/pgliteWorkerHost.ts was adapted from ` +
        `${ADAPTED_FROM_PGLITE_VERSION}. Re-diff it against the upstream src/worker/index.ts: if upstream ` +
        'fixed the closed-tab lock leak, delete the host and import `worker` from @electric-sql/pglite/worker ' +
        'again; otherwise port any upstream changes and bump ADAPTED_FROM_PGLITE_VERSION.',
    ).toBe(ADAPTED_FROM_PGLITE_VERSION);
  });
});
