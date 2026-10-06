import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LAST_SEEN_VERSION_KEY,
  checkWhatsNew,
  compareVersions,
  entriesNewerThan,
  markVersionSeen,
  parseChangelog,
} from '@/lib/changelog';

const fixture = readFileSync(new URL('./fixtures/changelog-sample.md', import.meta.url), 'utf8');

function memoryStorage(initial?: string) {
  const data = new Map<string, string>(initial ? [[LAST_SEEN_VERSION_KEY, initial]] : []);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const throwing = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

describe('parseChangelog', () => {
  const entries = parseChangelog(fixture);

  it('reads every release heading, newest first, with dates', () => {
    expect(entries.map((e) => e.version)).toEqual(['2.3.0', '2.2.0', '2.1.2', '2.1.1', '2.1.0']);
    expect(entries[0].date).toBe('2026-09-28');
  });

  it('groups bullets by section', () => {
    expect(Object.keys(entries[0].sections)).toEqual(['Bug Fixes', 'Features']);
    expect(Object.keys(entries[1].sections)).toContain('Performance Improvements');
  });

  it('strips commit hashes, issue links and markdown to plain text', () => {
    expect(entries[0].sections['Features']).toEqual([
      'mcp: create_folder tool that grants the agent write on the new folder',
    ]);
    const all = entries.flatMap((e) => Object.values(e.sections).flat());
    expect(all.length).toBeGreaterThan(20);
    for (const line of all) {
      expect(line).not.toMatch(/\]\(|\*\*|[0-9a-f]{40}|closes/);
    }
  });
});

describe('compareVersions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBe(1);
    expect(compareVersions('2.9.0', '2.10.0')).toBe(-1);
    expect(compareVersions('2.3.0', '2.3.0')).toBe(0);
  });
});

describe('entriesNewerThan', () => {
  it('keeps only versions after the last seen one', () => {
    const entries = parseChangelog(fixture);
    expect(entriesNewerThan(entries, '2.1.2').map((e) => e.version)).toEqual(['2.3.0', '2.2.0']);
    expect(entriesNewerThan(entries, '2.3.0')).toEqual([]);
  });
});

describe('checkWhatsNew', () => {
  it('records the current version silently on a fresh install', () => {
    const s = memoryStorage();
    expect(checkWhatsNew(s, '2.3.0')).toBeNull();
    expect(s.data.get(LAST_SEEN_VERSION_KEY)).toBe('2.3.0');
  });

  it('returns the last seen version after an update, until marked seen', () => {
    const s = memoryStorage('2.3.0');
    expect(checkWhatsNew(s, '2.5.0')).toBe('2.3.0');
    expect(checkWhatsNew(s, '2.5.0')).toBe('2.3.0');
    markVersionSeen(s, '2.5.0');
    expect(checkWhatsNew(s, '2.5.0')).toBeNull();
  });

  it('shows nothing when the version is unchanged or older', () => {
    expect(checkWhatsNew(memoryStorage('2.5.0'), '2.5.0')).toBeNull();
    expect(checkWhatsNew(memoryStorage('2.5.0'), '2.4.0')).toBeNull();
  });

  it('shows nothing and does not throw when storage throws', () => {
    expect(checkWhatsNew(throwing, '2.5.0')).toBeNull();
    expect(() => markVersionSeen(throwing, '2.5.0')).not.toThrow();
  });
});
