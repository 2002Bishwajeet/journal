// @vitest-environment happy-dom
/**
 * EditorProvider must never hand its children a destroyed editor.
 *
 * @tiptap/react's useEditor, with `immediatelyRender: true`, builds the editor
 * during render and schedules its destruction on the next tick unless the
 * component has mounted by then. In a concurrent render that yields before
 * committing (a slow machine, or a sibling that suspends), that tick fires
 * first: the render's editor is destroyed (schema = null), yet it is still the
 * value children commit with, and their effects run before useEditor's own
 * effect replaces it. TipTapEditor's word count then calls getText() and throws
 * "Cannot read properties of null (reading 'nodes')" — the editor pane's
 * "The editor failed to load." after a reload in CI.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createElement as h, startTransition, use, useEffect } from 'react';
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
      return new Promise(() => {});
    }
  },
}));
vi.mock('@/lib/yjs/flushPendingSave', () => ({ flushPendingSaveOnTeardown: vi.fn() }));
vi.mock('@/lib/db', () => ({
  upsertSearchIndex: vi.fn(),
  savePendingImageUpload: vi.fn(),
  updateSyncStatus: vi.fn(),
}));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ sync: vi.fn() }) }));
vi.mock('@/hooks/useNoteTitleMap', () => ({
  useNoteTitleMap: () => ({ map: new Map(), isReady: true }),
}));
vi.mock('@/hooks/useNotes', () => ({ createNoteWithContentInDb: vi.fn() }));
vi.mock('@/hooks/useDocumentSubscription', () => ({ useDocumentSubscription: vi.fn() }));
vi.mock('@/components/editor/hooks/useImageDeletionTracker', () => ({
  useImageDeletionTracker: vi.fn(),
}));

beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});

const metadata = {
  title: 'Note',
  folderId: 'folder',
  tags: [],
  timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
  excludeFromAI: false,
} as unknown as DocumentMetadata;

/** Reads the editor in an effect, like TipTapEditor's word count. */
function Reader({ reads }: { reads: string[] }) {
  const { editor } = useEditorContext();
  useEffect(() => {
    if (!editor) return;
    try {
      editor.getText();
      reads.push('ok');
    } catch (error) {
      reads.push((error as Error).message);
    }
  }, [editor, reads]);
  return null;
}

/** Holds the render open past a timer tick before it can commit. */
function Suspender({ promise }: { promise: Promise<void> }) {
  use(promise);
  return null;
}

describe('EditorProvider — commit after a yielded render', () => {
  it('never exposes a destroyed editor to its children', async () => {
    const reads: string[] = [];
    const promise = new Promise<void>((resolve) => setTimeout(resolve, 30));
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);

    startTransition(() => {
      root.render(
        h(
          MemoryRouter,
          null,
          h(EditorProvider, { docId: 'doc-1', metadata, children: h(Reader, { reads }) }),
          h(Suspender, { promise }),
        ),
      );
    });
    await new Promise((r) => setTimeout(r, 200));

    expect(reads).toEqual(['ok']);

    root.unmount();
    el.remove();
  });
});
