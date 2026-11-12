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
import * as Y from 'yjs';
import { updateSearchIndexContent } from '@/lib/db';
import { previewTextFromFragment } from '@/lib/yjs/previewText';
import { EditorProvider } from '@/components/editor/EditorProvider';
import { useEditorContext } from '@/components/editor/EditorContext';
import type { DocumentMetadata } from '@/types';

vi.mock('@/hooks/useAISettings', () => ({
  useAISettings: () => ({ settings: { grammarEnabled: false } }),
}));
const providerDocs = vi.hoisted(() => new Map<string, Y.Doc>());
vi.mock('@/lib/yjs', () => ({
  PGliteProvider: class {
    docId: string;
    constructor(docId: string, ydoc: Y.Doc) {
      this.docId = docId;
      providerDocs.set(docId, ydoc);
    }
    load() {
      // doc-2 loads at once so the update listener attaches; the rest never settle
      return this.docId === 'doc-2' ? Promise.resolve() : new Promise(() => {});
    }
    save() {
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

  it('writes the search text the Y.Doc walk produces, 500 ms after an edit', async () => {
    vi.mocked(updateSearchIndexContent).mockClear();
    const held: { editor: import('@tiptap/react').Editor | null } = { editor: null };
    function Grab() {
      const { editor } = useEditorContext();
      useEffect(() => {
        held.editor = editor;
      }, [editor]);
      return null;
    }
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    root.render(h(MemoryRouter, null, h(EditorProvider, { docId: 'doc-2', metadata, children: h(Grab) })));
    await vi.waitFor(() => expect(held.editor).not.toBeNull());

    held.editor!.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            { type: 'noteLink', attrs: { noteId: 'abc', label: 'Budget 2026' } },
            { type: 'text', text: ' today' },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'let x' }] },
      ],
    }, { emitUpdate: true });

    await vi.waitFor(() => expect(updateSearchIndexContent).toHaveBeenCalled(), { timeout: 10_000 });
    const written = vi.mocked(updateSearchIndexContent).mock.calls.at(-1)![1];
    const ydoc = providerDocs.get('doc-2')!;
    expect(written).toBe(previewTextFromFragment(ydoc.getXmlFragment('prosemirror')));
    expect(written).toBe('See Budget 2026 today\u001Flet x');

    root.unmount();
    el.remove();
  });
});
