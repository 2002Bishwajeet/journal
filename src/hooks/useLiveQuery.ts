import { useEffect, useState, startTransition } from 'react';
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

/**
 * Subscribe to a PGlite live (incremental) query. PGlite is the reactive source:
 * any write to the underlying table re-emits results, so the UI updates
 * progressively (e.g. notes streaming in during sync) with no manual invalidation.
 *
 * @param sql     query text
 * @param params  positional params (compared by value, not identity)
 * @param rowKey  unique column used by incrementalQuery for row diffing (e.g. 'doc_id')
 * @param enabled when false, no subscription is created and the result is empty
 */
export function useLiveQuery<T>(
  sql: string,
  params: ReadonlyArray<unknown>,
  rowKey: string,
  enabled: boolean = true,
): { data: T[]; isLoading: boolean } {
  const cacheKey = `${rowKey}::${sql}::${JSON.stringify(params)}`;

  const [data, setData] = useState<T[]>(() => {
    const e = enabled ? registry.get(cacheKey) : undefined;
    return e?.ready ? (e.rows as T[]) : [];
  });
  const [isLoading, setIsLoading] = useState<boolean>(
    () => enabled && !registry.get(cacheKey)?.ready,
  );

  // When the query key changes for the SAME hook instance (e.g. switching folder
  // or tag), reset to the new key's snapshot during render so the list never
  // flashes the previous query's rows. (React's "adjust state on prop change"
  // pattern — re-renders before paint, no stale frame.)
  const [renderedKey, setRenderedKey] = useState(cacheKey);
  if (renderedKey !== cacheKey) {
    setRenderedKey(cacheKey);
    const e = enabled ? registry.get(cacheKey) : undefined;
    setData(e?.ready ? (e.rows as T[]) : []);
    setIsLoading(enabled ? !e?.ready : false);
  }

  useEffect(() => {
    if (!enabled) {
      setData([]);
      setIsLoading(false);
      return;
    }
    let active = true;
    const listener = (rows: unknown[]) => {
      if (!active) return;
      // Sync emissions are non-urgent — keep user interactions responsive.
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
    entry.refs += 1;
    entry.listeners.add(listener);
    // Capture the entry by identity so the async closure below always targets
    // the entry it was created for — never a later generation that replaced it.
    const myEntry = entry;

    if (entry.ready) {
      listener(entry.rows);
    } else if (!entry.subscribing) {
      // First consumer (or a retry after a failed attempt) creates the shared
      // subscription. Gating on `subscribing` (not refs) lets a later mount
      // re-attempt if creation failed, instead of wedging the entry forever.
      entry.subscribing = true;
      void (async () => {
        try {
          const db = await getLiveDatabase();
          const lq = await db.live.incrementalQuery(
            sql,
            params as unknown[],
            rowKey,
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
        registry.delete(cacheKey);
        void e.unsubscribe?.();
      }
    };
    // cacheKey encodes rowKey+sql+params; depending on the raw (array) params would
    // re-subscribe on every render (rerender-dependencies). cacheKey is the gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, enabled]);

  return { data, isLoading };
}
