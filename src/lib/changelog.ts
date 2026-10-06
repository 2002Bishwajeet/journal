// Parses RELEASE_NOTES.md (hand-written, "## X.Y.Z (date)" / "### Section" / bullets;
// the conventional-changelog CHANGELOG.md format also parses) into entries the
// What's new dialog can render, and decides when to show it.

export interface ChangelogEntry {
  version: string;
  date: string;
  sections: Record<string, string[]>;
}

export const LAST_SEEN_VERSION_KEY = 'journal-last-seen-version';

/** The newest entries the Settings → About button shows. */
export const LATEST_ENTRY_COUNT = 3;

const HEADING = /^#{1,2}\s+\[?(\d+\.\d+\.\d+[^\]\s)]*)\]?(?:\([^)]*\))?\s*(?:\((\d{4}-\d{2}-\d{2})\))?/;

/** Numeric compare of the major.minor.patch core, so 2.10.0 > 2.9.0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0].split('.').map(Number);
  const pb = b.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** "**scope:** subject ([abc123](url)), closes [#1](url)" -> "scope: subject" */
function cleanBullet(raw: string): string {
  return raw
    .replace(/,?\s*closes\s.*$/i, '')
    .replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .trim();
}

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let section: string | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading) {
      entry = { version: heading[1], date: heading[2] ?? '', sections: {} };
      entries.push(entry);
      section = null;
      continue;
    }
    if (!entry) continue;
    const sectionMatch = /^###\s+(.+?)\s*$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    const bullet = /^[*-]\s+(.+)$/.exec(line);
    if (bullet && section) {
      const text = cleanBullet(bullet[1]);
      if (text) (entry.sections[section] ??= []).push(text);
    }
  }
  return entries;
}

export function entriesNewerThan(entries: ChangelogEntry[], version: string): ChangelogEntry[] {
  return entries.filter((e) => compareVersions(e.version, version) > 0);
}

/**
 * Returns the version the user last saw when the dialog is due, else null.
 * A fresh install records the current version silently; a storage failure
 * means no dialog.
 */
export function checkWhatsNew(storage: Pick<Storage, 'getItem' | 'setItem'>, current: string): string | null {
  try {
    const lastSeen = storage.getItem(LAST_SEEN_VERSION_KEY);
    if (!lastSeen) {
      storage.setItem(LAST_SEEN_VERSION_KEY, current);
      return null;
    }
    return compareVersions(lastSeen, current) < 0 ? lastSeen : null;
  } catch {
    return null;
  }
}

export function markVersionSeen(storage: Pick<Storage, 'setItem'>, current: string): void {
  try {
    storage.setItem(LAST_SEEN_VERSION_KEY, current);
  } catch {
    // Storage unavailable: the dialog just won't be due next time either.
  }
}
