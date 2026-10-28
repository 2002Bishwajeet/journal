/** #825: one item list for the note list rows and the note screen's More sheet. */
import { describe, it, expect, vi } from 'vitest';
import { Search } from 'lucide-react';
import { buildNoteMenuItems, type NoteMenuHandlers } from '@/helpers/noteMenuItems';
import { viewLabel } from '@/helpers/viewLabel';
import { PSEUDO_FOLDERS } from '@/lib/homebase/config';
import { markNewNote, takeNewNote } from '@/lib/newNoteFocus';
import type { NoteListEntry } from '@/types';

const note = (isPinned = false): NoteListEntry =>
  ({
    docId: 'n1',
    title: 'A note',
    preview: '',
    metadata: { title: 'A note', folderId: 'f1', isPinned, tags: [], timestamps: { created: '', modified: '' } },
  }) as unknown as NoteListEntry;

const handlers = (): NoteMenuHandlers => ({
  onTogglePin: vi.fn(),
  onShare: vi.fn(),
  onMoveToFolder: vi.fn(),
  onRemoveFromList: vi.fn(),
  onArchive: vi.fn(),
  onTrash: vi.fn(),
});

const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe('buildNoteMenuItems', () => {
  it('lists the actions of an own note, with Trash last and destructive', () => {
    const items = buildNoteMenuItems(note(), { isPeerNote: false, dotYouRoot: 'me.example', handlers: handlers() });
    expect(labels(items)).toEqual([
      'Pin',
      'Share…',
      'Move to folder…',
      'Export to Markdown',
      'Open in Owner Console',
      'Archive',
      'Move to Trash',
    ]);
    expect(items.at(-1)?.variant).toBe('destructive');
  });

  it('puts the extra items after Move to folder', () => {
    const extra = [{ label: 'Find in note', icon: Search, action: vi.fn() }];
    const items = buildNoteMenuItems(note(), { isPeerNote: false, dotYouRoot: 'me.example', handlers: handlers(), extra });
    expect(labels(items).slice(0, 4)).toEqual(['Pin', 'Share…', 'Move to folder…', 'Find in note']);
  });

  it('gives a note from someone else Remove from my list instead of Share and Move', () => {
    const items = buildNoteMenuItems(note(), { isPeerNote: true, dotYouRoot: 'me.example', handlers: handlers() });
    expect(labels(items)).toEqual([
      'Pin',
      'Export to Markdown',
      'Open in Owner Console',
      'Remove from my list',
      'Archive',
      'Move to Trash',
    ]);
  });

  it('shows Unpin for a pinned note and passes the new state on', () => {
    const h = handlers();
    const items = buildNoteMenuItems(note(true), { isPeerNote: false, dotYouRoot: 'me.example', handlers: h });
    expect(items[0].label).toBe('Unpin');
    items[0].action();
    expect(h.onTogglePin).toHaveBeenCalledWith('n1', false);
  });

  it('hands the note to the share, move, archive and trash handlers', () => {
    const h = handlers();
    const n = note();
    const items = buildNoteMenuItems(n, { isPeerNote: false, dotYouRoot: 'me.example', handlers: h });
    for (const label of ['Share…', 'Move to folder…', 'Archive', 'Move to Trash']) {
      items.find((i) => i.label === label)!.action();
    }
    expect(h.onShare).toHaveBeenCalledWith(n);
    expect(h.onMoveToFolder).toHaveBeenCalledWith(n);
    expect(h.onArchive).toHaveBeenCalledWith(n);
    expect(h.onTrash).toHaveBeenCalledWith('n1');
  });

  it('disables Archive when there is no archive handler', () => {
    const { onArchive: _onArchive, ...rest } = handlers();
    const items = buildNoteMenuItems(note(), { isPeerNote: false, dotYouRoot: 'me.example', handlers: rest });
    expect(items.find((i) => i.label === 'Archive')?.disabled).toBe(true);
  });
});

describe('viewLabel', () => {
  const folders = [{ id: 'f1', name: 'Main' }];

  it('names a folder, a tag, and the pseudo folders', () => {
    expect(viewLabel('f1', null, folders)).toBe('Main');
    expect(viewLabel('f1', 'work', folders)).toBe('#work');
    expect(viewLabel(PSEUDO_FOLDERS.trash, null, folders)).toBe('Trash');
    expect(viewLabel(PSEUDO_FOLDERS.archive, null, folders)).toBe('Archive');
    expect(viewLabel(PSEUDO_FOLDERS.shared, null, folders)).toBe('Shared');
  });

  it('has no label for an unknown folder', () => {
    expect(viewLabel('gone', null, folders)).toBeUndefined();
  });
});

describe('newNoteFocus', () => {
  it('answers true once for the note that was marked', () => {
    markNewNote('a');
    expect(takeNewNote('b')).toBe(false);
    expect(takeNewNote('a')).toBe(true);
    expect(takeNewNote('a')).toBe(false);
  });
});
