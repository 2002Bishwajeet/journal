import { useEffect, useState } from 'react';
import {
  LATEST_ENTRY_COUNT,
  checkWhatsNew,
  entriesNewerThan,
  markVersionSeen,
  parseChangelog,
  type ChangelogEntry,
} from '@/lib/changelog';

// Dynamic import keeps the changelog text out of the main entry chunk.
async function loadChangelog(): Promise<ChangelogEntry[]> {
  const { default: raw } = await import('../../CHANGELOG.md?raw');
  return parseChangelog(raw);
}

/** Entries the user skipped since they last opened the app; empty until due. */
export function useAutoWhatsNew() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);

  useEffect(() => {
    const lastSeen = checkWhatsNew(localStorage, __APP_VERSION__);
    if (!lastSeen) return;
    let cancelled = false;
    loadChangelog()
      .then((all) => {
        if (cancelled) return;
        const newer = entriesNewerThan(all, lastSeen);
        if (newer.length) setEntries(newer);
        else markVersionSeen(localStorage, __APP_VERSION__);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const close = () => {
    markVersionSeen(localStorage, __APP_VERSION__);
    setEntries([]);
  };
  return { entries, close };
}

/** The latest few entries, loaded when the user asks (Settings → About). */
export function useLatestWhatsNew() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [failed, setFailed] = useState(false);

  const open = () => {
    setFailed(false);
    loadChangelog()
      .then((all) => setEntries(all.slice(0, LATEST_ENTRY_COUNT)))
      .catch(() => setFailed(true));
  };
  return { entries, failed, open, close: () => setEntries([]) };
}
