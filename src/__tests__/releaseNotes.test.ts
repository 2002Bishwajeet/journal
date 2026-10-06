import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseChangelog } from '@/lib/changelog';
// @ts-expect-error -- plain .mjs release script, no types
import { stampRelease } from '../../scripts/release-notes.mjs';

const notes = readFileSync(new URL('../../RELEASE_NOTES.md', import.meta.url), 'utf8');

describe('RELEASE_NOTES.md', () => {
  it('parses into dated versions with New / Changed / Fixed sections, skipping Unreleased', () => {
    // Not entries[0]: every release adds a newer entry on top
    const entries = parseChangelog(notes);
    const v231 = entries.find((e) => e.version === '2.3.1');
    expect(v231?.date).toBe('2026-10-06');
    expect(Object.keys(v231?.sections ?? {})).toEqual(['New', 'Changed', 'Fixed']);
    expect(entries.some((e) => e.version === 'Unreleased')).toBe(false);
  });
});

describe('stampRelease', () => {
  const doc = '# Release notes\n\n## Unreleased\n\n### Fixed\n\n- A fix.\n\n## 1.0.0 (2026-01-01)\n\n### New\n\n- Old.\n';

  it('moves the Unreleased bullets under the new version and returns them', () => {
    const { markdown, body } = stampRelease(doc, '1.0.1', '2026-02-02');
    expect(body).toBe('### Fixed\n\n- A fix.');
    expect(markdown).toContain('## Unreleased\n\n## 1.0.1 (2026-02-02)\n\n### Fixed\n\n- A fix.\n\n## 1.0.0');
    expect(parseChangelog(markdown).map((e) => e.version)).toEqual(['1.0.1', '1.0.0']);
  });

  it('works when Unreleased is the last section', () => {
    const { body } = stampRelease('## Unreleased\n\n- Only.\n', '0.1.0', '2026-03-03');
    expect(body).toBe('- Only.');
  });

  it('refuses an empty Unreleased, so a release never ships without notes', () => {
    expect(() => stampRelease('## Unreleased\n\n## 1.0.0 (2026-01-01)\n- x\n', '1.0.1', '2026-02-02')).toThrow(/empty/);
  });
});
