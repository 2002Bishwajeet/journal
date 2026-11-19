import { useEffect, useState, useSyncExternalStore } from 'react';
import { getOpenProgress, subscribeBootProgress, OPEN_PROGRESS_DELAY_MS } from '@/lib/bootProgress';

/**
 * The percent an encrypted database's open has reached (#1365), or null while no open is
 * running or it has taken under OPEN_PROGRESS_DELAY_MS, so a fast open never flashes it.
 */
export function useOpenProgress(): number | null {
  const open = useSyncExternalStore(subscribeBootProgress, getOpenProgress);
  const startedAt = open?.startedAt;
  // The start of the open the delay has passed for.
  const [elapsedFor, setElapsedFor] = useState<number | null>(null);

  useEffect(() => {
    if (startedAt === undefined) return;
    const timer = setTimeout(() => setElapsedFor(startedAt), Math.max(0, startedAt + OPEN_PROGRESS_DELAY_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [startedAt]);

  return open && elapsedFor === open.startedAt ? open.percent : null;
}
