/**
 * A live block, shared by the editor and the share page so the two look the
 * same: the preview or the code, straight on the note with no card and no bar
 * (#420), and the view toggles over its top right corner. Rules that have to
 * beat the unlayered `.prose` styles are in src/index.css ("Live blocks").
 *
 * An html or react block can be `wide` (#557).
 */
import { useRef, type ReactNode } from 'react';
import type { LiveBlockKind } from '@/lib/liveBlocks';
import type { BlockStateStore } from '@/lib/liveBlockState';
import { cn } from '@/lib/utils';
import { LiveBlockPreview } from './LiveBlockPreview';

const LABELS: Record<LiveBlockKind, string> = { mermaid: 'Mermaid', svg: 'SVG', html: 'HTML', react: 'React' };

interface LiveBlockFrameProps {
  kind: LiveBlockKind;
  source: string;
  /** Show the preview; otherwise the code in `children` is what is visible. */
  preview: boolean;
  /** The block's node is selected in the editor. */
  selected?: boolean;
  /** While editing: name the kind and keep the toggles in view. A reader (the share page) gets neither until they hover. */
  labelled?: boolean;
  /** Where an html or react block's `journal.storage` keeps its state (#410). */
  store?: BlockStateStore;
  /** The fence asks for the full width of the pane (```react wide). Only an html or react block takes it. */
  wide?: boolean;
  /** The view toggles, as LiveBlockToggle buttons. */
  toggles: ReactNode;
  /** The code block's `<pre>`. */
  children: ReactNode;
}

// For the controls over a block (`group/block`): hidden until the block is hovered or holds focus.
const REVEALED =
  'opacity-0 transition-opacity duration-100 group-hover/block:opacity-100 group-focus-within/block:opacity-100 [@media(hover:none)]:opacity-100';

export function LiveBlockFrame({ kind, source, preview, selected, labelled, store, wide, toggles, children }: LiveBlockFrameProps) {
  const box = useRef<HTMLDivElement>(null);
  // The inline height fitContent last gave the box.
  const fittedHeight = useRef('');
  // A react block runs in the same frame as an html block (#426), so it gets the same box.
  const framed = kind === 'html' || kind === 'react';
  const wideBlock = framed && !!wide;
  // Only the editor lets the user drag the box taller; a reader gets the fitted height.
  const resizable = framed && !!labelled;

  // An html block is as tall as its content (#412) until the user drags the resize handle:
  // the browser then writes an inline height that is not the fitted one, and that one stays.
  const fitContent = (height: number) => {
    const el = box.current;
    if (!el || el.style.height !== fittedHeight.current) return;
    el.style.height = fittedHeight.current = `${height}px`;
  };

  return (
    <div
      data-live-block={kind}
      // Its width is in src/index.css ("Live blocks").
      data-live-block-wide={wideBlock ? '' : undefined}
      // `isolate` keeps the controls' z-index inside the block. The outline is the one a selected image gets (ImageNode).
      className={cn('group/block relative isolate my-4', selected && 'rounded-sm outline-2 outline-primary/60')}
    >
      {/* While editing, a plain row above the block: its kind, then the toggles. For a reader, only
          the toggles, over the corner and out of sight until the block is hovered or has keyboard
          focus (always there on a device that cannot hover). */}
      {(toggles || labelled) && (
        <div
          role="group"
          aria-label={`${LABELS[kind]} block`}
          contentEditable={false}
          className={cn(
            'z-10 flex items-center justify-end font-sans select-none',
            !labelled && cn('absolute right-0 top-0', REVEALED),
          )}
        >
          {labelled && <span className="mr-auto text-xs font-medium text-muted-foreground">{LABELS[kind]}</span>}
          {toggles}
        </div>
      )}
      {/* An html block's preview and code share this box and its height (400px until the content
          reports its own, or the box is resized in the editor), so switching views does not move
          the page. `resize` needs a non-visible overflow. */}
      <div
        ref={box}
        contentEditable={preview ? false : undefined}
        data-live-block-preview={preview ? kind : undefined}
        className={cn(
          framed && 'relative h-[400px] overflow-hidden',
          resizable && 'resize-y',
        )}
      >
        {preview && <LiveBlockPreview kind={kind} source={source} store={store} onHeight={fitContent} wide={wideBlock} />}
        {children}
        {resizable && (
          // Drawn over the native resize handle, which is hard to see on a page. Dragging it
          // needs a mouse, so touch devices do not get the hint.
          <span
            aria-hidden
            contentEditable={false}
            className={cn(
              'pointer-events-none absolute bottom-0 right-0 flex size-5 items-center justify-center rounded-tl-md border-l border-t bg-secondary text-muted-foreground pointer-coarse:hidden',
              REVEALED,
            )}
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
 * A view toggle over a live block. The button is 44px tall (36px on a desktop
 * with a mouse) so it is an easy target; the pill inside it carries the look
 * and the hover, pressed and focus states.
 */
export function LiveBlockToggle({ pressed, onClick, children }: LiveBlockToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="group/toggle flex h-11 touch-manipulation items-center px-1 outline-none md:pointer-fine:h-9"
    >
      <span className="rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground group-hover/toggle:bg-accent group-hover/toggle:text-foreground group-focus-visible/toggle:ring-[3px] group-focus-visible/toggle:ring-ring/50 group-aria-pressed/toggle:bg-secondary group-aria-pressed/toggle:text-foreground">
        {children}
      </span>
    </button>
  );
}
