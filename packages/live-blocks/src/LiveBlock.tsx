/**
 * A live block for a host that shows notes it did not write (a feed, a reader): the preview
 * alone, as Journal's share page draws it, in a box as tall as the block's content. Like any
 * block Journal does not trust (#975), an html or react block's frame has a thin edge, so a
 * form it draws doesn't pass as the host's own, and a link it opens shows where it goes first.
 *
 * Its saved state starts from `initialState` (the owner's, as JSON text) and a reader's own
 * changes last while the block is shown: they never reach the note.
 */
import { useRef, useState } from 'react';
import { memoryBlockStateStore } from './blockState';
import { LiveBlockPreview, type LiveBlockPreviewProps } from './LiveBlockPreview';

export interface LiveBlockProps extends Pick<LiveBlockPreviewProps, 'kind' | 'source' | 'wide' | 'theme'> {
  /** The block's saved state (```html id=k3f9) as JSON text, from the note it is in. */
  initialState?: string;
  /** Opens a link the user clicked in the block. By default the browser asks first, showing the whole URL. */
  onLink?: (url: string) => void;
}

export function LiveBlock({ kind, source, wide, theme, initialState, onLink = confirmAndOpen }: LiveBlockProps) {
  const box = useRef<HTMLDivElement>(null);
  const [store] = useState(() => memoryBlockStateStore(initialState));
  const framed = kind === 'html' || kind === 'react';
  // One function for the block's life: the published build has no React Compiler, and a new one
  // each render would make the preview listen on its port again.
  const [fitContent] = useState(() => (height: number) => {
    if (box.current) box.current.style.height = `${height}px`;
  });

  return (
    <div data-live-block={kind} data-live-block-wide={framed && wide ? '' : undefined} data-live-block-untrusted={framed ? '' : undefined} className="relative isolate my-4">
      {/* The frame reaches 12px (FRAME_BLEED) past the block on every side, and the box pads that back, as in Journal's LiveBlockFrame. */}
      <div ref={box} data-live-block-preview={kind} className={framed ? 'relative -m-3 box-content! h-[400px] overflow-hidden p-3' : undefined}>
        <LiveBlockPreview kind={kind} source={source} store={store} onHeight={fitContent} wide={wide} onLink={onLink} theme={theme} />
        {framed && <span aria-hidden className="pointer-events-none absolute inset-3 rounded-md border border-dashed border-muted-foreground/40" />}
      </div>
    </div>
  );
}

function confirmAndOpen(url: string) {
  if (window.confirm(`A block in this note wants to open a link. Someone else may have written it, so check where it goes:\n\n${url}`)) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
