/**
 * Table-of-Contents Panel (desktop only)
 *
 * Subscribes to the editor's `update` event (debounced) and renders the
 * document outline. Clicking an entry focuses the editor and scrolls the
 * matching heading into view. Mounted as a right rail by EditorPage.
 */

import { useEffect, useState } from 'react';
import { Editor } from '@tiptap/react';
import { useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { extractHeadings, type HeadingEntry } from '@/lib/editor/extractHeadings';
import { cn } from '@/lib/utils';

interface TocPanelProps {
  editor: Editor;
  onClose: () => void;
}

// Per-level indentation (H1..H6). Steps of pl-2 keep the outline readable.
const indentByLevel: Record<number, string> = {
  1: 'pl-2',
  2: 'pl-4',
  3: 'pl-6',
  4: 'pl-8',
  5: 'pl-10',
  6: 'pl-12',
};

export function TocPanel({ editor, onClose }: TocPanelProps) {
  const reducedMotion = useReducedMotion();
  const [headings, setHeadings] = useState<HeadingEntry[]>(() =>
    editor.view && !editor.isDestroyed ? extractHeadings(editor.state.doc) : []
  );

  useEffect(() => {
    if (!editor) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const recompute = () => setHeadings(extractHeadings(editor.state.doc));
    const handleUpdate = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        recompute();
        timeout = null;
      }, 500);
    };
    recompute();
    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
      if (timeout) clearTimeout(timeout);
    };
  }, [editor]);

  const goToHeading = (pos: number) => {
    if (!editor.view || editor.isDestroyed) return;
    // Move the cursor to the heading but let us own the scroll animation below.
    editor.chain().focus(pos, { scrollIntoView: false }).run();
    // pos is the position *before* the heading; pos + 1 lands inside it so the
    // resolved DOM node's closest heading element is the scroll target.
    const { node } = editor.view.domAtPos(pos + 1);
    const el = node instanceof HTMLElement ? node : node.parentElement;
    const target = el?.closest('h1, h2, h3, h4, h5, h6') ?? el;
    target?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  return (
    <aside className="w-64 shrink-0 flex flex-col border-l border-gray-200 dark:border-gray-700 bg-background">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contents
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Close table of contents"
          aria-label="Close table of contents"
          className="p-1 rounded-md hover:bg-muted transition-colors duration-200"
        >
          <X size={14} />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Table of contents">
        {headings.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted-foreground">No headings yet</p>
        ) : (
          <ul className="space-y-0.5">
            {headings.map((heading, index) => (
              <li key={`${heading.pos}-${index}`}>
                <button
                  type="button"
                  onClick={() => goToHeading(heading.pos)}
                  title={heading.text || 'Untitled heading'}
                  className={cn(
                    'block w-full truncate rounded-md py-1 pr-2 text-left text-xs text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground',
                    indentByLevel[heading.level] ?? 'pl-2'
                  )}
                >
                  {heading.text || 'Untitled heading'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </aside>
  );
}
