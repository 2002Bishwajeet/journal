/**
 * The box around a live block, shared by the editor and the share page so the
 * two look the same: a bar with the block's kind and its view toggles, above
 * either the preview or the code. Rules that have to beat the unlayered
 * `.prose` styles are in src/index.css ("Live blocks").
 */
import type { ReactNode } from 'react';
import type { LiveBlockKind } from '@/lib/liveBlocks';
import { cn } from '@/lib/utils';
import { LiveBlockPreview } from './LiveBlockPreview';

const LABELS: Record<LiveBlockKind, string> = { mermaid: 'Mermaid', svg: 'SVG', html: 'HTML' };

interface LiveBlockFrameProps {
  kind: LiveBlockKind;
  source: string;
  /** Show the preview; otherwise the code in `children` is what is visible. */
  preview: boolean;
  /** The view toggles, as LiveBlockToggle buttons. */
  toggles: ReactNode;
  /** The code block's `<pre>`. */
  children: ReactNode;
}

export function LiveBlockFrame({ kind, source, preview, toggles, children }: LiveBlockFrameProps) {
  return (
    <div data-live-block={kind} className="my-4 overflow-hidden rounded-lg border bg-card text-card-foreground">
      <div contentEditable={false} className="flex items-center justify-between border-b pl-3 pr-1 font-sans select-none">
        <span className="text-xs font-medium text-muted-foreground">{LABELS[kind]}</span>
        <div className="flex">{toggles}</div>
      </div>
      {/* An html block's preview and code share this box and its height (400px until resized),
          so switching views does not move the page. `resize` needs a non-visible overflow. */}
      <div
        contentEditable={preview ? false : undefined}
        data-live-block-preview={preview ? kind : undefined}
        className={cn(kind === 'html' && 'relative h-[400px] resize-y overflow-hidden')}
      >
        {preview && <LiveBlockPreview kind={kind} source={source} />}
        {children}
        {kind === 'html' && (
          // Drawn over the native resize handle, which is hard to see on a page. Dragging it
          // needs a mouse, so touch devices do not get the hint.
          <span
            aria-hidden
            contentEditable={false}
            className="pointer-events-none absolute bottom-0 right-0 flex size-5 items-center justify-center rounded-tl-md border-l border-t bg-secondary text-muted-foreground pointer-coarse:hidden"
          >
            <svg viewBox="0 0 10 10" className="size-2.5" fill="none" stroke="currentColor" strokeLinecap="round">
              <path d="M9 1 1 9M9 5 5 9" />
            </svg>
          </span>
        )}
      </div>
    </div>
  );
}

interface LiveBlockToggleProps {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}

/**
 * A view toggle for the frame's bar. The button is the full height of the bar
 * (44px, or 36px on a desktop with a mouse) so it is an easy target; the pill
 * inside it carries the hover, pressed and focus states.
 */
export function LiveBlockToggle({ pressed, onClick, children }: LiveBlockToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="group/toggle flex h-11 touch-manipulation items-center px-1 outline-none md:pointer-fine:h-9"
    >
      <span className="rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground group-hover/toggle:bg-accent group-hover/toggle:text-foreground group-focus-visible/toggle:ring-[3px] group-focus-visible/toggle:ring-ring/50 group-aria-pressed/toggle:bg-secondary group-aria-pressed/toggle:text-foreground">
        {children}
      </span>
    </button>
  );
}
