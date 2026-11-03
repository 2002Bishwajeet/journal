// @vitest-environment happy-dom
/** #825: "New" focuses the new note's title on touch layouts only, and the mark is used once. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DocumentMetadata } from '@/types';

vi.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ editor: null, isLoading: false }),
}));
vi.mock('@/hooks', () => ({ useDeviceType: () => 'desktop' }));
vi.mock('@/components/editor/EditorToolbar', () => ({ default: () => null }));
vi.mock('@/components/editor/MobileToolbar', () => ({ default: () => null }));
vi.mock('@/components/editor/BubbleMenuToolbar', () => ({ default: () => null }));
vi.mock('@/components/editor/table/TableColumnMenu', () => ({ TableColumnMenu: () => null }));
vi.mock('@/components/editor/table/TableRowMenu', () => ({ TableRowMenu: () => null }));
vi.mock('@/components/editor/TagInput', () => ({ TagInput: () => null }));
vi.mock('@/components/editor/NoteCover', () => ({ NoteCover: () => null }));

import TipTapEditor from '@/components/editor/TipTapEditor';
import { markNewNote, takeNewNote } from '@/lib/newNoteFocus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const meta = (title: string) => ({ title, timestamps: {} }) as unknown as DocumentMetadata;

let root: Root;
let host: HTMLElement;
const field = () => host.querySelector<HTMLTextAreaElement>('textarea[placeholder="Untitled"]')!;
const show = (focusNewTitle: boolean) =>
  act(async () => {
    root.render(createElement(TipTapEditor, { noteId: 'n', metadata: meta(''), focusNewTitle }));
  });

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('TipTapEditor new-note title focus', () => {
  it('focuses the title of a new note on a touch layout', async () => {
    markNewNote('n');
    await show(true);
    expect(document.activeElement).toBe(field());
  });

  it('does not focus on desktop, and clears the mark so a later touch layout does not focus', async () => {
    markNewNote('n');
    await show(false);
    expect(document.activeElement).not.toBe(field());
    expect(takeNewNote('n')).toBe(false);
  });

  it('does not focus a note that New did not create', async () => {
    await show(true);
    expect(document.activeElement).not.toBe(field());
  });
});
