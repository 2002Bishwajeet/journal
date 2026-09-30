/**
 * A code block on the share page (#408): the <pre> with a Copy button over its
 * top right corner. The box is a wide block (`.share-wide` in src/index.css),
 * so a block with long lines grows past the reading column instead of wrapping.
 */
import { useEffect, useRef, useState, type ComponentProps } from 'react';

interface CopyableCodeBlockProps extends ComponentProps<'pre'> {
  /** The block's text, as the author wrote it. */
  source: string;
}

export function CopyableCodeBlock({ source, children, ...rest }: CopyableCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const reset = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reset.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
    } catch {
      // The browser refused (no permission, or not a secure context): nothing was copied.
      return;
    }
    setCopied(true);
    clearTimeout(reset.current);
    reset.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="share-wide relative my-4">
      {/* `!` beats the unlayered `.prose pre`: the box carries the margin, and the right padding
          keeps the end of the longest line clear of the button. */}
      <pre {...rest} className="m-0! pr-20!">
        {children}
      </pre>
      {/* The button is a 44px touch target (smaller on a desktop with a mouse); the pill inside carries the look. */}
      <button
        type="button"
        onClick={copy}
        className="group/copy absolute right-1 top-1 flex h-11 min-w-11 touch-manipulation items-center justify-center px-1 font-sans outline-none select-none md:pointer-fine:h-9"
      >
        <span
          aria-live="polite"
          className="rounded-md border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground group-hover/copy:bg-accent group-hover/copy:text-foreground group-focus-visible/copy:ring-[3px] group-focus-visible/copy:ring-ring/50"
        >
          {copied ? 'Copied' : 'Copy'}
        </span>
      </button>
    </div>
  );
}
