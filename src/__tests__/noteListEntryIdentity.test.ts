/**
 * Stable-identity contract for the note-list row mapper. PGlite re-runs the full
 * query on every write and returns fresh row objects; toNoteListEntry must hand
 * back the SAME entry reference while a row's observable content is unchanged so
 * NoteItem's React.memo holds and only the edited row re-renders. Any observable
 * change (title / preview / any metadata field, including archival flips that do
 * not bump the modified timestamp) must yield a new reference.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  toNoteListEntry,
  clearNoteListEntryCache,
  type NoteListRow,
} from '@/lib/db/queries';
import type { DocumentMetadata } from '@/types';

const DOC_A = '40000000-0000-0000-0000-000000000001';
const DOC_B = '40000000-0000-0000-0000-000000000002';

function makeMetadata(over: Partial<DocumentMetadata> = {}): DocumentMetadata {
  return {
    title: 'Note',
    folderId: 'main',
    excludeFromAI: false,
    archivalStatus: 0,
    isPinned: false,
    timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
    ...over,
  };
}

/** A fresh row object each call — mirrors PGlite returning new objects per emission. */
function makeRow(
  docId: string,
  opts: { title?: string; preview?: string; modified?: string; archivalStatus?: number; isPinned?: boolean } = {},
): NoteListRow {
  return {
    doc_id: docId,
    title: opts.title ?? 'Note',
    preview: opts.preview ?? 'Body text',
    metadata: makeMetadata({
      title: opts.title ?? 'Note',
      archivalStatus: opts.archivalStatus ?? 0,
      isPinned: opts.isPinned ?? false,
      timestamps: {
        created: '2026-01-01T00:00:00.000Z',
        modified: opts.modified ?? '2026-01-01T00:00:00.000Z',
      },
    }),
  };
}

afterEach(() => {
  // Reset between tests so identities never leak across cases (mirrors the
  // clearAllLocalData reset that runs on logout).
  clearNoteListEntryCache();
});

describe('toNoteListEntry — stable row identity', () => {
  it('returns the SAME reference for an unchanged row across emissions', () => {
    const first = toNoteListEntry(makeRow(DOC_A));
    const second = toNoteListEntry(makeRow(DOC_A)); // different object, identical content
    expect(second).toBe(first);
    // And it still maps the shape consumers expect.
    expect(first).toMatchObject({ docId: DOC_A, title: 'Note', preview: 'Body text' });
  });

  it('returns a NEW reference when the modified timestamp changes', () => {
    const first = toNoteListEntry(makeRow(DOC_A, { modified: '2026-01-01T00:00:00.000Z' }));
    const second = toNoteListEntry(makeRow(DOC_A, { modified: '2026-01-02T00:00:00.000Z' }));
    expect(second).not.toBe(first);
    expect(second.metadata.timestamps.modified).toBe('2026-01-02T00:00:00.000Z');
  });

  it('returns a NEW reference when the title or preview changes', () => {
    const base = toNoteListEntry(makeRow(DOC_A, { title: 'Old', preview: 'p' }));
    const titled = toNoteListEntry(makeRow(DOC_A, { title: 'New', preview: 'p' }));
    expect(titled).not.toBe(base);

    const previewed = toNoteListEntry(makeRow(DOC_A, { title: 'New', preview: 'p2' }));
    expect(previewed).not.toBe(titled);
  });

  it('returns a NEW reference when metadata changes WITHOUT a modified bump (archival/pin)', () => {
    // setNoteArchivalStatusLocal flips archivalStatus without touching
    // timestamps.modified, so keying on modified alone would serve a stale entry.
    const active = toNoteListEntry(makeRow(DOC_A, { archivalStatus: 0 }));
    const trashed = toNoteListEntry(makeRow(DOC_A, { archivalStatus: 2 }));
    expect(trashed).not.toBe(active);
    expect(trashed.metadata.archivalStatus).toBe(2);

    const pinned = toNoteListEntry(makeRow(DOC_A, { archivalStatus: 2, isPinned: true }));
    expect(pinned).not.toBe(trashed);
  });

  it('tracks identity independently per doc_id', () => {
    const a1 = toNoteListEntry(makeRow(DOC_A));
    const b1 = toNoteListEntry(makeRow(DOC_B));
    expect(b1).not.toBe(a1);
    // Re-emitting both keeps each row's own reference.
    expect(toNoteListEntry(makeRow(DOC_A))).toBe(a1);
    expect(toNoteListEntry(makeRow(DOC_B))).toBe(b1);
  });

  it('drops cached identities after clearNoteListEntryCache (no cross-session leak)', () => {
    const before = toNoteListEntry(makeRow(DOC_A));
    clearNoteListEntryCache();
    const after = toNoteListEntry(makeRow(DOC_A)); // identical content, cache was wiped
    expect(after).not.toBe(before);
  });
});
