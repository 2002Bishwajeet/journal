// @vitest-environment happy-dom
/** #825: on touch layouts the note screen's More button opens one sheet with every note action. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { NoteScreenMenu } from '@/components/editor/NoteScreenMenu';
import { ContentsSheet } from '@/components/editor/ContentsSheet';
import type { NoteScreenActions } from '@/hooks/useNoteScreenActions';
import type { NoteListEntry } from '@/types';

const togglePin = vi.fn();
vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => ({ getRoot: () => 'me.example' }) }));
vi.mock('@/hooks/useNotes', () => ({ useNotes: () => ({ togglePin: { mutate: togglePin } }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = {
  docId: 'n1',
  title: 'A note',
  preview: '',
  metadata: { title: 'A note', folderId: 'f1', isPinned: false, tags: [], timestamps: { created: '', modified: '' } },
} as unknown as NoteListEntry;

const actions = (): NoteScreenActions => ({
  backLabel: 'Main',
  onShare: vi.fn(),
  onMoveToFolder: vi.fn(),
  onArchive: vi.fn(),
  onTrash: vi.fn(),
  onRemoveFromList: vi.fn(),
});

let editor: Editor;
let host: HTMLElement;
let root: Root;

const setup = (content: string) => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  editor = new Editor({ element, extensions: createBaseExtensions(), content });
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  editor.destroy();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const mount = (node: Parameters<Root['render']>[0]) => act(async () => root.render(node));
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const more = () => document.querySelector<HTMLButtonElement>('button[aria-label="More"]');
const rows = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((r) => r.textContent);
const row = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((r) => r.textContent === label);
const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

describe('NoteScreenMenu', () => {
  it('opens a sheet named after the note with the note actions, Find, Contents and Version history', async () => {
    setup('<h2>Intro</h2><p>Hello world</p>');
    const a = actions();
    await mount(
      createElement(NoteScreenMenu, { note, isPeerNote: false, editor: editor as never, actions: a, onOpenHistory: vi.fn() }),
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await click(more());

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('data-variant')).toBe('bottom');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe('A note');
    expect(rows()).toEqual([
      'Pin',
      'Share…',
      'Move to folder…',
      'Find in note',
      'Contents',
      'Version history',
      'Export to Markdown',
      'Open in Owner Console',
      'Archive',
      'Move to Trash',
    ]);
    // Archive and Trash are a group of their own, apart from the rest.
    const groups = [...document.querySelectorAll('[role="group"]')];
    expect(groups).toHaveLength(2);
    expect(groups[1].textContent).toBe('ArchiveMove to Trash');
  });

  it('leaves out Contents for a note without headings and Version history for a note from someone else', async () => {
    setup('<p>No headings here</p>');
    await mount(
      createElement(NoteScreenMenu, { note, isPeerNote: true, editor: editor as never, actions: actions() }),
    );
    await click(more());
    expect(rows()).toEqual([
      'Pin',
      'Find in note',
      'Export to Markdown',
      'Open in Owner Console',
      'Remove from my list',
      'Archive',
      'Move to Trash',
    ]);
  });

  it('runs a tapped item once the sheet has closed, and opens the find bar', async () => {
    setup('<p>Hello world</p>');
    const a = actions();
    await mount(createElement(NoteScreenMenu, { note, isPeerNote: false, editor: editor as never, actions: a }));
    await click(more());
    await click(row('Share…'));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(a.onShare).toHaveBeenCalledTimes(1);
    expect(a.onShare).toHaveBeenCalledWith(note);

    await click(more());
    expect(editor.storage.searchAndReplace.isOpen).toBe(false);
    await click(row('Find in note'));
    await settle();
    expect(editor.storage.searchAndReplace.isOpen).toBe(true);
  });

  it('asks before moving to Trash, in a centred alert', async () => {
    setup('<p>Hello</p>');
    const a = actions();
    await mount(createElement(NoteScreenMenu, { note, isPeerNote: false, editor: editor as never, actions: a }));
    await click(more());
    await click(row('Move to Trash'));
    await settle();
    expect(a.onTrash).not.toHaveBeenCalled();
    const alert = document.querySelector('[role="dialog"]')!;
    expect(alert.textContent).toContain('Move to Trash?');
    expect(alert.getAttribute('data-variant')).not.toBe('bottom');

    const confirm = [...alert.querySelectorAll('button')].find((b) => b.textContent === 'Move to Trash');
    await click(confirm);
    expect(a.onTrash).toHaveBeenCalledWith('n1');
  });

  it('Cancel closes the sheet and runs nothing', async () => {
    setup('<p>Hello</p>');
    const a = actions();
    await mount(createElement(NoteScreenMenu, { note, isPeerNote: false, editor: editor as never, actions: a }));
    await click(more());
    await click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel'));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(a.onShare).not.toHaveBeenCalled();
    expect(a.onTrash).not.toHaveBeenCalled();
    expect(togglePin).not.toHaveBeenCalled();
  });
});

describe('ContentsSheet', () => {
  it('lists the headings and closes when one is tapped', async () => {
    setup('<h1>One</h1><p>text</p><h2>Two</h2><p>more</p>');
    const onOpenChange = vi.fn();
    await mount(createElement(ContentsSheet, { editor: editor as never, open: true, onOpenChange }));
    const items = [...document.querySelectorAll<HTMLElement>('nav[aria-label="Table of contents"] button')];
    expect(items.map((b) => b.textContent)).toEqual(['One', 'Two']);
    expect(items[1].className).toContain('pl-8');
    await click(items[1]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
