import { useEffect, useRef, useState, startTransition } from 'react';
import { getLiveDatabase } from '@/lib/db/pglite';

interface LiveEntry {
  refs: number;
  rows: unknown[];
  ready: boolean;
  subscribing: boolean;
  listeners: Set<(rows: unknown[]) => void>;
  unsubscribe?: () => Promise<void>;
}

// Shared, ref-counted subscriptions keyed by (rowKey, sql, params). Multiple
// components reading the same query share one PGlite live subscription.
const registry = new Map<string, LiveEntry>();

// When the last consumer of a query unmounts (e.g. switching folders), keep the
// subscription warm instead of tearing it down. The live query keeps its rows
// fresh, so returning to a recently-viewed folder/tag shows them instantly
// rather than flashing a loading state and re-querying. Bounded by an LRU so we
// don't leak a live subscription for every folder/tag ever visited.
const IDLE_LIMIT = 12;
const idleKeys = new Set<string>(); // insertion-ordered LRU of idle cacheKeys

function evictIdle() {
  while (idleKeys.size > IDLE_LIMIT) {
    const oldest = idleKeys.values().next().value as string;
    idleKeys.delete(oldest);
    const e = registry.get(oldest);
    if (e && e.refs <= 0) {
      registry.delete(oldest);
      void e.unsubscribe?.()?.catch(() => {});
    }
  }
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

    let entry = registry.get(cacheKey);
    if (!entry) {
      entry = { refs: 0, rows: [], ready: false, subscribing: false, listeners: new Set() };
      registry.set(cacheKey, entry);
    }
    idleKeys.delete(cacheKey); // reacquired — no longer idle
    entry.refs += 1;
    entry.listeners.add(listener);
    // Capture the entry by identity so the async closure below always targets
    // the entry it was created for — never a later generation that replaced it.
    const myEntry = entry;

    if (entry.ready) {
      // Already-cached snapshot — deliver via a microtask so this stays out of
      // the synchronous effect body (a re-render bails out if rows are unchanged).
      const rows = entry.rows;
      queueMicrotask(() => listener(rows));
    } else if (!entry.subscribing) {
      // First consumer (or a retry after a failed attempt) creates the shared
      // subscription. Gating on `subscribing` (not refs) lets a later mount
      // re-attempt if creation failed, instead of wedging the entry forever.
      entry.subscribing = true;
      void (async () => {
        try {
          const db = await getLiveDatabase();
          const lq = await db.live.query(
            sqlRef.current,
            paramsRef.current as unknown[],
            (res) => {
              // Drop emissions for an entry that was discarded and replaced.
              if (registry.get(cacheKey) !== myEntry) return;
              myEntry.rows = res.rows;
              myEntry.listeners.forEach((l) => l(res.rows));
            },
          );
          if (registry.get(cacheKey) !== myEntry) {
            // Every consumer of this generation unmounted before the
            // subscription resolved — tear the orphan down instead of leaking it.
            await lq.unsubscribe();
            return;
          }
          myEntry.rows = lq.initialResults.rows;
          myEntry.unsubscribe = lq.unsubscribe;
          myEntry.ready = true;
          myEntry.subscribing = false;
          myEntry.listeners.forEach((l) => l(myEntry.rows));
        } catch (err) {
          console.error('[useLiveQuery] subscription failed:', err);
          // Clear the flag so a later mount can retry rather than stay wedged.
          myEntry.subscribing = false;
          if (registry.get(cacheKey) === myEntry) {
            myEntry.listeners.forEach((l) => l([]));
          }
        }
      })();
    }

    return () => {
      active = false;
      const e = registry.get(cacheKey);
      if (!e) return;
      e.listeners.delete(listener);
      e.refs -= 1;
      if (e.refs <= 0) {
        // Keep the subscription warm; refresh its LRU position and evict overflow.
        idleKeys.delete(cacheKey);
        idleKeys.add(cacheKey);
        evictIdle();
      }
    };
  }, [cacheKey, enabled]);

  return { data, isLoading };
}
