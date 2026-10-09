// @vitest-environment happy-dom
/** #534: the title field follows metadata.title unless the user is typing in it. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DocumentMetadata } from '@/types';

vi.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ editor: null, isLoading: false }),
}));
vi.mock('@/hooks', () => ({ useDeviceType: () => 'desktop' }));
vi.mock('katex/dist/katex.min.css', () => ({}));
vi.mock('@/components/editor/EditorToolbar', () => ({ default: () => null }));
vi.mock('@/components/editor/MobileToolbar', () => ({ default: () => null }));
vi.mock('@/components/editor/BubbleMenuToolbar', () => ({ default: () => null }));
vi.mock('@/components/editor/AISuggestionOverlay', () => ({ AISuggestionOverlay: () => null }));
vi.mock('@/components/editor/table/TableColumnMenu', () => ({ TableColumnMenu: () => null }));
vi.mock('@/components/editor/table/TableRowMenu', () => ({ TableRowMenu: () => null }));
vi.mock('@/components/editor/TagInput', () => ({ TagInput: () => null }));
vi.mock('@/components/editor/NoteCover', () => ({ NoteCover: () => null }));

import TipTapEditor from '@/components/editor/TipTapEditor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const meta = (title: string) => ({ title, timestamps: {} }) as unknown as DocumentMetadata;

let root: Root;
let host: HTMLElement;
const field = () => host.querySelector<HTMLTextAreaElement>('textarea[placeholder="Untitled"]')!;
const show = (title: string) =>
  act(async () => {
    root.render(createElement(TipTapEditor, { noteId: 'n', metadata: meta(title) }));
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

describe('TipTapEditor title sync', () => {
  it('shows a title changed elsewhere', async () => {
    await show('A');
    expect(field().value).toBe('A');
    await show('B');
    expect(field().value).toBe('B');
  });

  it('does not overwrite the field while it is focused', async () => {
    await show('A');
    field().focus();
    await show('B');
    expect(field().value).toBe('A');
  });
});
