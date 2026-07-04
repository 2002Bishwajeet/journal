import { useEffect, useRef, useState, startTransition } from 'react';
import { getLiveDatabase } from '@/lib/db/pglite';

interface LiveEntry {
  refs: number;
  rows: unknown[];
  ready: boolean;
  subscribing: boolean;
  // Parked: the last consumer unmounted, so the live PGlite subscription has
  // been torn down, but the entry and its last rows are retained (see park()).
  // A parked entry holds NO live subscription — it costs nothing on writes.
  parked: boolean;
  // Generation token: bumped on park and on each new subscription so a stale
  // subscription's async callback/result can be fenced out even though the entry
  // object itself survives across park→reacquire.
  gen: number;
  listeners: Set<(rows: unknown[]) => void>;
  unsubscribe?: () => Promise<void>;
  // Per-entry trailing-debounce state for coalescing burst emissions.
  coalesceTimer?: ReturnType<typeof setTimeout>;
  pendingRows?: unknown[];
  hasPending: boolean;
}

// Shared, ref-counted subscriptions keyed by (rowKey, sql, params). Multiple
// components reading the same query share one PGlite live subscription.
const registry = new Map<string, LiveEntry>();

// When the last consumer of a query unmounts (e.g. switching folders), the live
// PGlite subscription is torn down but the entry keeps its last rows (parked).
// Returning to a recently-viewed folder/tag then shows those rows instantly
// rather than flashing a loading state, while typing/sync only pay for the
// queries that still have a live consumer. Bounded by an LRU so parked rows
// don't grow without limit.
const IDLE_LIMIT = 12;
const idleKeys = new Set<string>(); // insertion-ordered LRU of parked cacheKeys

// Trailing-debounce window (ms) for coalescing a burst of emissions on one entry
// into a single follow-up notification. The first emission of a burst fires on
// the leading edge (immediate) so interactive changes stay instant; only the
// follow-ups inside the window collapse into one trailing emission.
const COALESCE_MS = 150;

function clearCoalesce(e: LiveEntry) {
  if (e.coalesceTimer !== undefined) {
    clearTimeout(e.coalesceTimer);
    e.coalesceTimer = undefined;
  }
  e.hasPending = false;
  e.pendingRows = undefined;
}

// Deliver rows to listeners with a per-entry leading-edge + trailing debounce:
// the first emission fires immediately, further emissions inside COALESCE_MS are
// collapsed into a single trailing notification carrying the latest rows.
function notify(entry: LiveEntry, rows: unknown[]) {
  entry.rows = rows;
  if (entry.coalesceTimer === undefined) {
    entry.hasPending = false;
    entry.listeners.forEach((l) => l(rows));
    entry.coalesceTimer = setTimeout(() => flush(entry), COALESCE_MS);
  } else {
    entry.pendingRows = rows;
    entry.hasPending = true;
  }
}

function flush(entry: LiveEntry) {
  entry.coalesceTimer = undefined;
  if (entry.hasPending) {
    entry.hasPending = false;
    const rows = entry.pendingRows as unknown[];
    entry.pendingRows = undefined;
    entry.listeners.forEach((l) => l(rows));
  }
}

// Last consumer left: tear down the live subscription but retain the entry and
// its rows (parked) so a later reacquire is instant. Bumping gen fences any
// emission still in flight from the (now torn-down) subscription. LRU-bounded.
function park(cacheKey: string, e: LiveEntry) {
  clearCoalesce(e);
  e.parked = true;
  e.gen += 1;
  const unsub = e.unsubscribe;
  e.unsubscribe = undefined;
  void unsub?.()?.catch(() => {});
  idleKeys.delete(cacheKey);
  idleKeys.add(cacheKey);
  evictIdle();
}

function evictIdle() {
  while (idleKeys.size > IDLE_LIMIT) {
    const oldest = idleKeys.values().next().value as string;
    idleKeys.delete(oldest);
    const e = registry.get(oldest);
    if (e && e.refs <= 0) {
      registry.delete(oldest);
      clearCoalesce(e);
      void e.unsubscribe?.()?.catch(() => {});
    }
  }
}

function subscribe(
  cacheKey: string,
  myEntry: LiveEntry,
  sql: string,
  params: ReadonlyArray<unknown>,
): void {
  myEntry.subscribing = true;
  const myGen = (myEntry.gen += 1);
  void (async () => {
    try {
      const db = await getLiveDatabase();
      const lq = await db.live.query(sql, params as unknown[], (res) => {
        // Drop emissions from a subscription that has been superseded (the entry
        // was parked/replaced, or a newer subscription took over).
        if (registry.get(cacheKey) !== myEntry || myEntry.gen !== myGen) return;
        notify(myEntry, res.rows);
      });
      if (registry.get(cacheKey) !== myEntry || myEntry.gen !== myGen) {
        // Superseded before the subscription resolved — orphan it.
        await lq.unsubscribe();
        return;
      }
      myEntry.unsubscribe = lq.unsubscribe;
      myEntry.subscribing = false;
      myEntry.parked = false;
      myEntry.ready = true;
      // First fresh result: deliver immediately (leading edge via notify).
      notify(myEntry, lq.initialResults.rows);
    } catch (err) {
      console.error('[useLiveQuery] subscription failed:', err);
      // Clear the flag so a later mount can retry rather than stay wedged.
      if (myEntry.gen === myGen) myEntry.subscribing = false;
      if (registry.get(cacheKey) === myEntry && myEntry.gen === myGen) {
        myEntry.listeners.forEach((l) => l([]));
      }
    }
  })();
}

/**
 * Acquire a shared PGlite live subscription for `cacheKey`, registering
 * `listener` for updates. Returns the current cached rows (empty until the first
 * result is ready), whether they are ready, and a `release` to call when the
 * consumer goes away.
 *
 * Reacquiring a parked entry serves its cached rows synchronously (ready: true)
 * and starts a fresh subscription, so folder/tag switches never flash a loading
 * state while still refreshing to live data.
 */
export function acquireLiveQuery(
  cacheKey: string,
  sql: string,
  params: ReadonlyArray<unknown>,
  listener: (rows: unknown[]) => void,
): { rows: unknown[]; ready: boolean; release: () => void } {
  let entry = registry.get(cacheKey);
  if (!entry) {
    entry = {
      refs: 0,
      rows: [],
      ready: false,
      subscribing: false,
      parked: false,
      gen: 0,
      listeners: new Set(),
      hasPending: false,
    };
    registry.set(cacheKey, entry);
  }
  idleKeys.delete(cacheKey); // reacquired — no longer idle
  entry.refs += 1;
  entry.listeners.add(listener);
  // Capture the entry by identity so the async closures always target the entry
  // they were created for — never a later generation that replaced it.
  const myEntry = entry;

  const release = () => {
    const e = registry.get(cacheKey);
    if (!e) return;
    e.listeners.delete(listener);
    e.refs -= 1;
    if (e.refs <= 0) park(cacheKey, e);
  };

  if (entry.ready && !entry.parked) {
    // Live snapshot already cached — deliver via a microtask so this stays out
    // of the caller's synchronous path (a re-render bails if rows are unchanged).
    const rows = entry.rows;
    queueMicrotask(() => {
      if (registry.get(cacheKey) === myEntry) listener(rows);
    });
  } else if (entry.parked) {
    // Serve the parked rows now (ready), then resubscribe for fresh data. The
    // fresh subscription bumps gen, so any in-flight one from before orphans.
    entry.parked = false;
    subscribe(cacheKey, myEntry, sql, params);
  } else if (!entry.subscribing) {
    // First consumer (or a retry after a failed attempt) opens the subscription.
    // Gating on `subscribing` (not refs) lets a later mount re-attempt if
    // creation failed, instead of wedging the entry forever.
    subscribe(cacheKey, myEntry, sql, params);
  }

  return { rows: entry.rows, ready: entry.ready, release };
}

/**
 * Subscribe to a PGlite live query. PGlite is the reactive source: any write to
 * the underlying table re-emits the full result set, so the UI updates
 * progressively (e.g. notes streaming in during sync) with no manual invalidation.
 *
 * Uses db.live.query (re-run on change) rather than incrementalQuery (row-level
 * diffing): incrementalQuery's per-subscription setup costs ~1.2s on the single
 * worker thread, and the boot path opens several subscriptions at once. live.query
 * sets up ~2.6x faster, which dominates startup; these list result sets are small
 * enough that re-running on change is cheap.
 *
 * @param sql     query text
 * @param params  positional params (compared by value, not identity)
 * @param rowKey  discriminator folded into the subscription cache key (e.g. 'doc_id')
 * @param enabled when false, no subscription is created and the result is empty
 */
export function useLiveQuery<T>(
  sql: string,
  params: ReadonlyArray<unknown>,
  rowKey: string,
  enabled: boolean = true,
): { data: T[]; isLoading: boolean } {
  const cacheKey = `${rowKey}::${sql}::${JSON.stringify(params)}`;

  // The subscription effect re-runs only when cacheKey/enabled change; the raw
  // inputs are read through "latest" refs (cacheKey already encodes when they
  // meaningfully change), keeping the dependency list honest without disabling
  // exhaustive-deps. Refs are synced in an effect — never written during render.
  const sqlRef = useRef(sql);
  const paramsRef = useRef(params);
  useEffect(() => {
    sqlRef.current = sql;
    paramsRef.current = params;
  }, [sql, params]);

  const [data, setData] = useState<T[]>(() => {
    const e = enabled ? registry.get(cacheKey) : undefined;
    return e?.ready ? (e.rows as T[]) : [];
  });
  const [isLoading, setIsLoading] = useState<boolean>(
    () => enabled && !registry.get(cacheKey)?.ready,
  );

  // Reset to the new key's snapshot during render when the query key or the
  // enabled flag changes, so switching folder/tag never flashes the previous
  // query's rows. (React's adjust-state-on-change pattern — re-renders before
  // paint, and keeps setState out of the effect body.)
  const stateKey = `${cacheKey}::${enabled}`;
  const [renderedKey, setRenderedKey] = useState(stateKey);
  if (renderedKey !== stateKey) {
    setRenderedKey(stateKey);
    const e = enabled ? registry.get(cacheKey) : undefined;
    setData(e?.ready ? (e.rows as T[]) : []);
    setIsLoading(enabled ? !e?.ready : false);
  }

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    const listener = (rows: unknown[]) => {
      if (!active) return;
      // Subscription callback (external store) — non-urgent, so keep user
      // interactions responsive while sync emissions land.
      startTransition(() => {
        setData(rows as T[]);
        setIsLoading(false);
      });
    };

    const { release } = acquireLiveQuery(
      cacheKey,
      sqlRef.current,
      paramsRef.current,
      listener,
    );

    return () => {
      active = false;
      release();
    };
  }, [cacheKey, enabled]);

  return { data, isLoading };
}
