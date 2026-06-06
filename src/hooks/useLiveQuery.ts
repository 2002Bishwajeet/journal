import { useEffect, useState, startTransition } from 'react';
import { getLiveDatabase } from '@/lib/db/pglite';

interface LiveEntry {
  refs: number;
  rows: unknown[];
  ready: boolean;
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
 */
export function useLiveQuery<T>(
  sql: string,
  params: ReadonlyArray<unknown>,
  rowKey: string,
): { data: T[]; isLoading: boolean } {
  const cacheKey = `${rowKey}::${sql}::${JSON.stringify(params)}`;

  const [data, setData] = useState<T[]>(() => {
    const e = registry.get(cacheKey);
    return e?.ready ? (e.rows as T[]) : [];
  });
  const [isLoading, setIsLoading] = useState<boolean>(() => !registry.get(cacheKey)?.ready);

  useEffect(() => {
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
      entry = { refs: 0, rows: [], ready: false, listeners: new Set() };
      registry.set(cacheKey, entry);
    }
    entry.refs += 1;
    entry.listeners.add(listener);

    if (entry.ready) {
      listener(entry.rows);
    } else if (entry.refs === 1) {
      // First consumer creates the shared subscription.
      void (async () => {
        try {
          const db = await getLiveDatabase();
          const lq = await db.live.incrementalQuery(
            sql,
            params as unknown[],
            rowKey,
            (res) => {
              const e = registry.get(cacheKey);
              if (!e) return;
              e.rows = res.rows;
              e.listeners.forEach((l) => l(res.rows));
            },
          );
          const e = registry.get(cacheKey);
          if (!e) {
            // Every consumer unmounted before the subscription was ready.
            await lq.unsubscribe();
            return;
          }
          e.rows = lq.initialResults.rows;
          e.unsubscribe = lq.unsubscribe;
          e.ready = true;
          e.listeners.forEach((l) => l(e.rows));
        } catch (err) {
          console.error('[useLiveQuery] subscription failed:', err);
          registry.get(cacheKey)?.listeners.forEach((l) => l([]));
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
  }, [cacheKey]);

  return { data, isLoading };
}
