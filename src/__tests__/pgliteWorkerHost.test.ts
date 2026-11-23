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

  /** How many requests wait for `name`. */
  waiting(name: string): number {
    return this.queues.get(name)?.length ?? 0;
  }

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

// A fresh leader id per test, and tab ids under it: earlier tests' leaders are
// never torn down, and one still connected to a tab of the same name answers
// its calls too (calls are numbered the same way in every test).
let ID = '';
let run = 0;
const channels: BroadcastChannel[] = [];

/** Resolves once `condition` holds; fails after `ms` rather than leaving the test to time out. */
async function until(condition: () => boolean, what: string, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface Tab {
  rpc: (method: string, ...args: unknown[]) => Promise<unknown>;
  close: () => void;
  /** Gives up the tab-close lock while the tab keeps running, as if the browser had dropped it. */
  loseCloseLock: () => void;
}

// What PGliteWorker does on the client: hold its tab-close lock for its
// lifetime, announce itself until the leader connects it, then RPC.
async function openTab(locks: FakeLocks, name: string): Promise<Tab> {
  const tabId = `${ID}-${name}`;
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
  try {
    expect(await withinMs(connected, 2_000), `the leader never connected tab ${name}`).not.toBe('timed out');
  } finally {
    clearInterval(announce);
  }

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
    loseCloseLock: () => releaseCloseLock(),
  };
}

/** The leader has run the close handlers of the tab, and holds its close lock for good. */
const leaderSawClose = (locks: FakeLocks, name: string) =>
  until(() => locks.waiting(`pglite-tab-close:${ID}-${name}`) === 0, `the leader saw tab ${name} close`);

function withinMs<T>(promise: Promise<T>, ms: number): Promise<T | 'timed out'> {
  return Promise.race([promise, new Promise<'timed out'>((resolve) => setTimeout(() => resolve('timed out'), ms))]);
}

describe('pgliteWorkerHost', () => {
  let locks: FakeLocks;
  let db: PGlite;

  beforeEach(() => {
    ID = `host-test-${run++}`;
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
      const queue = vi.spyOn(db, `_runExclusive${kind}` as `_runExclusiveQuery`);
      void leaving.rpc(`_acquire${kind}Lock`).catch(() => {});
      await until(() => queue.mock.calls.length === 1, 'the request queued in the leader behind the holder');
      leaving.close();
      await leaderSawClose(locks, 'leaving');

      await holder.rpc(`_release${kind}Lock`); // the closed tab's grant fires now

      const next = await openTab(locks, 'next');
      expect(await withinMs(next.rpc(`_acquire${kind}Lock`), 2_000)).not.toBe('timed out');
      await next.rpc(`_release${kind}Lock`);
    },
  );

  // WebKit restarting its Networking process (#1467) can leave a running tab
  // whose close lock the leader got: its calls must fail, not wait for good.
  it.each(['Query', 'Transaction'])(
    'rejects a %s lock request that was queued when its tab\'s close lock was granted',
    async (kind) => {
      const holder = await openTab(locks, 'holder');
      await holder.rpc(`_acquire${kind}Lock`);

      const dropped = await openTab(locks, 'dropped');
      const queue = vi.spyOn(db, `_runExclusive${kind}` as `_runExclusiveQuery`);
      const pending = dropped.rpc(`_acquire${kind}Lock`);
      await until(() => queue.mock.calls.length === 1, 'the request queued in the leader behind the holder');
      dropped.loseCloseLock();
      await leaderSawClose(locks, 'dropped');

      await holder.rpc(`_release${kind}Lock`);
      await expect(withinMs(pending, 2_000)).rejects.toThrow(/connection to the database worker was closed/);
      await expect(withinMs(dropped.rpc('getDebugLevel'), 2_000)).rejects.toThrow(/connection to the database worker was closed/);
    },
  );

  it('answers every later call of a tab whose close lock was granted with an error', async () => {
    const tab = await openTab(locks, 'dropped');
    tab.loseCloseLock();
    await leaderSawClose(locks, 'dropped');
    await expect(withinMs(tab.rpc('_acquireQueryLock'), 2_000)).rejects.toThrow(/connection to the database worker was closed/);

    const other = await openTab(locks, 'other');
    expect(await withinMs(other.rpc('_acquireQueryLock'), 2_000)).not.toBe('timed out');
    await other.rpc('_releaseQueryLock');
  });

  it('still serves queries from other tabs after one closes', async () => {
    const tab = await openTab(locks, 'a');
    await tab.rpc('_acquireQueryLock');
    await tab.rpc('_releaseQueryLock');
    tab.close();
    const other = await openTab(locks, 'b');
    expect(await withinMs(other.rpc('_acquireQueryLock'), 2_000)).not.toBe('timed out');
    await other.rpc('_releaseQueryLock'); // db.close() waits for held query locks
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
