import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useReducedMotion } from 'framer-motion';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { extractHeadings, type HeadingEntry } from '@/lib/editor/extractHeadings';
import { scrollToHeading } from '@/lib/editor/scrollToHeading';

// Per-level indentation (H1..H6).
const indentByLevel: Record<number, string> = {
  1: 'pl-4',
  2: 'pl-8',
  3: 'pl-12',
  4: 'pl-16',
  5: 'pl-20',
  6: 'pl-24',
};

/** The note's headings in a bottom sheet (phones, #825); tapping one scrolls to it and closes the sheet. */
export function ContentsSheet({
  editor,
  open,
  onOpenChange,
}: {
  editor: Editor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reducedMotion = useReducedMotion();
  // The note as it is when the sheet opens; kept while the sheet slides away.
  const [headings, setHeadings] = useState<HeadingEntry[]>([]);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && editor.view && !editor.isDestroyed) setHeadings(extractHeadings(editor.state.doc));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent variant="bottom" aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>Contents</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <nav aria-label="Table of contents">
            <ul className="bg-muted divide-border divide-y overflow-hidden rounded-xl">
              {headings.map((heading, index) => (
                <li key={`${heading.pos}-${index}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      scrollToHeading(editor, heading.pos, !reducedMotion);
                    }}
                    className={`active:bg-accent flex min-h-13 w-full items-center pr-4 text-left text-base outline-none focus-visible:bg-accent ${indentByLevel[heading.level] ?? 'pl-4'}`}
                  >
                    <span className="line-clamp-2">{heading.text || 'Untitled heading'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
