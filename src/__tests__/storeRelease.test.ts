/**
 * #1304: the iOS and Android store builds. The build-number and version rules of
 * scripts/asc-release.mjs, and the store release notes from RELEASE_NOTES.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildNumber,
  compareVersions,
  lastReleased,
  marketingVersion,
  nextPatch,
  toCancel,
  versionToUse,
  // @ts-expect-error -- plain .mjs release script, no types
} from '../../scripts/asc-release.mjs';
// @ts-expect-error -- plain .mjs release script, no types
import { storeNotes } from '../../scripts/release-notes.mjs';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const version = (versionString: string, appVersionState: string) => ({
  id: versionString,
  attributes: { versionString, appVersionState },
});

describe('the iOS build number', () => {
  it('is the commit count when no uploaded build is higher', () => {
    expect(buildNumber(2860, ['2845', '2800'])).toBe(2860);
  });

  it('is one above the highest uploaded build when that is not below the commit count', () => {
    expect(buildNumber(2840, ['2845', '2800'])).toBe(2846);
    expect(buildNumber(2845, ['2845'])).toBe(2846);
  });

  it('ignores build numbers that are not whole numbers', () => {
    expect(buildNumber(10, ['2.71.1.4', ''])).toBe(10);
  });
});

describe('the iOS marketing version', () => {
  it('compares versions by number, not text', () => {
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1);
    expect(compareVersions('2.71.1', '2.71.1')).toBe(0);
    expect(compareVersions('2.71', '2.71.1')).toBe(-1);
    expect(nextPatch('2.71.1')).toBe('2.71.2');
  });

  it('takes the last version the App Store approved, not one in review or in preparation', () => {
    const versions = [
      version('2.70.0', 'REPLACED_WITH_NEW_VERSION'),
      version('2.71.0', 'READY_FOR_DISTRIBUTION'),
      version('2.71.1', 'WAITING_FOR_REVIEW'),
      version('2.72.0', 'PREPARE_FOR_SUBMISSION'),
    ];
    expect(lastReleased(versions)).toBe('2.71.0');
    expect(lastReleased([{ attributes: { versionString: '1.0.0', appStoreState: 'READY_FOR_SALE' } }])).toBe('1.0.0');
    expect(lastReleased([version('1.0.0', 'WAITING_FOR_REVIEW')])).toBeUndefined();
  });

  it("is the tag's version on a release", () => {
    expect(marketingVersion({ tag: 'v2.72.0', packageVersion: '2.72.0', released: '2.71.1' })).toBe('2.72.0');
  });

  it('stops a release whose tag is not above the released version', () => {
    expect(() => marketingVersion({ tag: 'v2.71.1', packageVersion: '2.71.1', released: '2.71.1' })).toThrow(
      /not above 2\.71\.1/,
    );
  });

  it("is package.json's version on main while the App Store has not released it", () => {
    expect(marketingVersion({ packageVersion: '2.71.1', released: '2.71.0' })).toBe('2.71.1');
    expect(marketingVersion({ packageVersion: '2.71.1' })).toBe('2.71.1');
  });

  it('is the next patch on main once the App Store has released that version (its train is closed)', () => {
    expect(marketingVersion({ packageVersion: '2.71.1', released: '2.71.1' })).toBe('2.71.2');
    expect(marketingVersion({ packageVersion: '2.70.0', released: '2.71.1' })).toBe('2.71.2');
  });
});

describe('the App Review submission', () => {
  it('cancels only submissions that wait for review or are in review', () => {
    const submissions = ['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW', 'UNRESOLVED_ISSUES', 'COMPLETE'].map(
      (state) => ({ id: state, attributes: { state } }),
    );
    expect(toCancel(submissions).map((s: { id: string }) => s.id)).toEqual([
      'WAITING_FOR_REVIEW',
      'IN_REVIEW',
      'UNRESOLVED_ISSUES',
    ]);
  });

  it('reuses the editable version with the same version string, else the other editable one', () => {
    const versions = [version('2.71.0', 'READY_FOR_DISTRIBUTION'), version('2.71.1', 'DEVELOPER_REJECTED')];
    expect(versionToUse(versions, '2.71.1')?.id).toBe('2.71.1');
    expect(versionToUse(versions, '2.72.0')?.id).toBe('2.71.1');
    expect(versionToUse([version('2.71.0', 'READY_FOR_DISTRIBUTION')], '2.72.0')).toBeUndefined();
  });
});

describe('the store release notes', () => {
  const notes = `## Unreleased

## 2.72.0 (2026-11-20)

### New

- A **bold** change with \`code\` and a [link](https://example.com).

### Fixed

- A fix.

## 2.71.10 (2026-11-19)

- Older.
`;

  it("are the version's section as plain text", () => {
    expect(storeNotes(notes, '2.72.0', 4000)).toBe('New\n• A bold change with code and a link.\n\nFixed\n• A fix.');
  });

  it('do not take a version with a longer number for this one', () => {
    expect(() => storeNotes(notes, '2.71.1', 4000)).toThrow(/no "## 2\.71\.1" section/);
  });

  it('are cut at a whole line, and never end on a section name', () => {
    const cut = storeNotes(notes, '2.72.0', 50);
    expect(cut).toBe('New\n• A bold change with code and a link.\n…');
    expect(cut.length).toBeLessThanOrEqual(50);
  });

  it('fit the Google Play limit for every version in RELEASE_NOTES.md', () => {
    const md = read('RELEASE_NOTES.md');
    const versions = [...md.matchAll(/^## (\d+\.\d+\.\d+) \(/gm)].map((m) => m[1]);
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(storeNotes(md, v, 500).length).toBeLessThanOrEqual(500);
  });
});

describe('the store workflows', () => {
  it.each(['ios-release.yml', 'android-release.yml'])('%s builds with the store env and never the web billing URL', (file) => {
    const workflow = read(`.github/workflows/${file}`);
    expect(workflow).toContain('JOURNAL_BILLING_URL: https://journal-billing.cloudx.run');
    expect(workflow).toContain("JOURNAL_RELEASE_BUILD: '1'");
    expect(workflow).not.toMatch(/^\s*VITE_BILLING_URL:/m);
  });

  it('runs both from Manual Release in submit mode', () => {
    const release = read('.github/workflows/manual-release.yml');
    for (const file of ['ios-release.yml', 'android-release.yml']) {
      expect(release).toContain(`uses: ./.github/workflows/${file}\n    with:\n      mode: submit`);
    }
  });
});
