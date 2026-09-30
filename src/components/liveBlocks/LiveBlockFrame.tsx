/**
 * A live block, shared by the editor and the share page so the two look the
 * same: the preview or the code, straight on the note with no card and no bar
 * (#420), and the view toggles over its top right corner. Rules that have to
 * beat the unlayered `.prose` styles are in src/index.css ("Live blocks").
 */
import { useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { LiveBlockKind } from '@/lib/liveBlocks';
import { cn } from '@/lib/utils';
import { LiveBlockPreview } from './LiveBlockPreview';

const LABELS: Record<LiveBlockKind, string> = { mermaid: 'Mermaid', svg: 'SVG', html: 'HTML' };

interface LiveBlockFrameProps {
  kind: LiveBlockKind;
  source: string;
  /** Show the preview; otherwise the code in `children` is what is visible. */
  preview: boolean;
  /** The block's node is selected in the editor. */
  selected?: boolean;
  /** The view toggles, as LiveBlockToggle buttons. */
  toggles: ReactNode;
  /** The code block's `<pre>`. */
  children: ReactNode;
}

// For the controls over a block (`group/block`): hidden until the block is hovered or holds focus.
const REVEALED =
  'opacity-0 transition-opacity duration-100 group-hover/block:opacity-100 group-focus-within/block:opacity-100 [@media(hover:none)]:opacity-100';

function subscribeToFullscreen(onChange: () => void) {
  document.addEventListener('fullscreenchange', onChange);
  return () => document.removeEventListener('fullscreenchange', onChange);
}

export function LiveBlockFrame({ kind, source, preview, selected, toggles, children }: LiveBlockFrameProps) {
  const block = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // The inline height fitContent last gave the box.
  const fittedHeight = useRef('');
  const fullscreen = useSyncExternalStore(
    subscribeToFullscreen,
    () => block.current !== null && document.fullscreenElement === block.current,
    () => false,
  );

  // An html block is as tall as its content (#412) until the user drags the resize handle:
  // the browser then writes an inline height that is not the fitted one, and that one stays.
  const fitContent = (height: number) => {
    const el = box.current;
    if (!el || el.style.height !== fittedHeight.current) return;
    el.style.height = fittedHeight.current = `${height}px`;
  };

  return (
    <div
      ref={block}
      data-live-block={kind}
      // `isolate` keeps the controls' z-index inside the block. The outline is the one a selected image gets (ImageNode).
      className={cn('group/block relative isolate my-4', selected && 'rounded-sm outline-2 outline-primary/60')}
      // A browser leaves full screen on Esc by itself, before the page sees the key. This is for
      // where the key does reach the page: headless Chromium (the e2e suite) has no such browser UI.
      onKeyDown={(event) => {
        if (event.key === 'Escape' && fullscreen) void document.exitFullscreen();
      }}
    >
      {/* Out of sight until the block is hovered or has keyboard focus; always there on a device
          that cannot hover. A full-screen block shows them as a bar: src/index.css ("Live blocks"). */}
      <div
        role="group"
        aria-label={`${LABELS[kind]} block`}
        contentEditable={false}
        className={cn('absolute right-0 top-0 z-10 flex justify-end font-sans select-none', REVEALED)}
      >
        {toggles}
        {/* The whole block goes full screen, not just its frame, so this button stays. */}
        {kind === 'html' && document.fullscreenEnabled && (
          <LiveBlockToggle pressed={fullscreen} onClick={() => void (fullscreen ? document.exitFullscreen() : block.current?.requestFullscreen())}>
            Full screen
          </LiveBlockToggle>
        )}
      </div>
      {/* An html block's preview and code share this box and its height (400px until the content
          reports its own, or the box is resized), so switching views does not move the page.
          `resize` needs a non-visible overflow. Full screen: src/index.css ("Live blocks"). */}
      <div
        ref={box}
        contentEditable={preview ? false : undefined}
        data-live-block-preview={preview ? kind : undefined}
        className={cn(kind === 'html' && 'relative h-[400px] resize-y overflow-hidden')}
      >
        {preview && <LiveBlockPreview kind={kind} source={source} onHeight={fitContent} />}
        {children}
        {kind === 'html' && (
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
