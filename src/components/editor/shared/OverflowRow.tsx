/**
 * A toolbar row that never wraps and never scrolls (#1392): the items that do not fit move into a
 * "More" popover at the end. Item widths are measured once, with every item shown, then a resize
 * only does arithmetic on them (`fitCount`).
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { fitCount } from './fitCount';

export interface OverflowItem {
  key: string;
  node: ReactNode;
  /** A divider between groups: it never ends the row and never leads the More panel. */
  divider?: boolean;
}

export function OverflowRow({ items, className }: { items: OverflowItem[]; className: string }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const measured = useRef<{ sig: string; widths: number[] } | null>(null);
  const [fit, setFit] = useState<{ sig: string; shown: number } | null>(null);
  const sig = items.map((item) => item.key).join();

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const update = () => {
      // Hidden (a background tab): nothing to measure yet.
      if (row.clientWidth === 0) return;
      // Until this item set is measured, every item is on screen (see `fit` below).
      if (measured.current?.sig !== sig) {
        measured.current = { sig, widths: Array.from(row.children, (child) => child.getBoundingClientRect().width) };
      }
      const style = getComputedStyle(row);
      const available = row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const shown = fitCount(measured.current.widths, items.map((item) => !!item.divider), available);
      setFit((prev) => (prev?.sig === sig && prev.shown === shown ? prev : { sig, shown }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => observer.disconnect();
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps -- `items` is the same set whenever `sig` is

  const shown = fit?.sig === sig ? fit.shown : items.length;
  const hidden = items.slice(shown);

  return (
    <div ref={rowRef} role="toolbar" aria-label="Formatting" className={className}>
      {items.slice(0, shown).map((item) => (
        <div key={item.key} className="flex shrink-0 items-center">
          {item.node}
        </div>
      ))}
      {hidden.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="More"
              title="More"
              onMouseDown={(e) => e.preventDefault()}
              className="shrink-0 rounded-md p-2 transition-colors hover:bg-muted data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
            >
              <MoreHorizontal size={18} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-auto max-w-[min(18rem,calc(100vw-1rem))] p-2"
            // The note keeps its caret and selection while the panel is open.
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <div className="flex flex-wrap items-center gap-0.5">
              {hidden.map((item, i) =>
                item.divider ? (
                  i > 0 && <div key={item.key} className="my-1 h-px basis-full bg-border" />
                ) : (
                  <div key={item.key} className="flex items-center">
                    {item.node}
                  </div>
                ),
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
