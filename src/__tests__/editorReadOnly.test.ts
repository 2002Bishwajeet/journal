// @vitest-environment happy-dom
/**
 * #897: a note shared with the host as a viewer opens read-only. EditorProvider takes
 * the role as `readOnly`; the editor is not editable while it is set, and follows it
 * when the owner changes the host's role with the note open.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { act, createElement as h, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { EditorProvider } from '@/components/editor/EditorProvider';
import { useEditorContext } from '@/components/editor/EditorContext';
import type { DocumentMetadata } from '@/types';

vi.mock('@/hooks/useAISettings', () => ({
  useAISettings: () => ({ settings: { grammarEnabled: false } }),
}));
vi.mock('@/lib/yjs', () => ({
  PGliteProvider: class {
    load() {
      return Promise.resolve();
    }
  },
}));
vi.mock('@/lib/yjs/flushPendingSave', () => ({ flushPendingSaveOnTeardown: vi.fn() }));
vi.mock('@/lib/db', () => ({
  updateSearchIndexContent: vi.fn(),
  savePendingImageUpload: vi.fn(),
  updateSyncStatus: vi.fn(),
}));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ sync: vi.fn() }) }));
vi.mock('@/hooks/useNoteTitleMap', () => ({
  useNoteTitleMap: () => ({ map: new Map(), isReady: true }),
}));
vi.mock('@/lib/notes/createNote', () => ({ createNoteWithContentInDb: vi.fn() }));
vi.mock('@/hooks/useDocumentSubscription', () => ({ useDocumentSubscription: vi.fn() }));
vi.mock('@/components/editor/hooks/useImageDeletionTracker', () => ({
  useImageDeletionTracker: vi.fn(),
}));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const metadata = {
  title: 'Note',
  folderId: 'folder',
  tags: [],
  timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
  excludeFromAI: false,
  authorOdinId: 'frodo.id',
} as unknown as DocumentMetadata;

const seen: { editable?: boolean; readOnly?: boolean } = {};
/** Records what the editor says after every render (the test renders twice, after the provider's effects). */
function Reader() {
  const { editor, readOnly } = useEditorContext();
  useEffect(() => {
    Object.assign(seen, { editable: editor?.isEditable, readOnly });
  });
  return null;
}

describe('EditorProvider readOnly', () => {
  it('makes the editor not editable for a viewer, and editable again when that changes', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    const render = (readOnly: boolean) =>
      act(async () => {
        root.render(
          h(MemoryRouter, null,
            h(EditorProvider, { docId: 'doc-1', metadata, editorOdinId: 'sam.id', readOnly, children: h(Reader) })),
        );
        await new Promise((r) => setTimeout(r, 0));
      });

    await render(true);
    await render(true);
    expect(seen).toEqual({ editable: false, readOnly: true });

    await render(false);
    await render(false);
    expect(seen).toEqual({ editable: true, readOnly: false });

    await act(async () => root.unmount());
    el.remove();
  });
});
