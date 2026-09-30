/**
 * Renders the preview of a live block (code block whose language is `mermaid`,
 * `svg` or `html`) inside LiveBlockFrame, which the editor and the share page
 * both use.
 *
 * - mermaid: rendered by the lazily imported mermaid runtime in strict mode.
 *   A parse or load error is shown as text; it never throws to the caller.
 * - svg: shown through an <img> data URI, so the source is never injected into
 *   the DOM and its scripts never run.
 * - html: runs in a sandboxed srcdoc frame that fills the frame's resizable
 *   box and takes the note's colours and font through buildSrcdoc (#420).
 *   The source is untrusted (an LLM or a collaborator can write it):
 *   `sandbox="allow-scripts"` alone gives the frame an opaque origin, so it
 *   cannot reach the app's DOM, storage or cookies, and the CSP from
 *   buildSrcdoc keeps it off the network. Never add another sandbox token;
 *   e2e/editor/live-html-sandbox.spec.ts holds the proof. The one thing that
 *   crosses the boundary is the frame's report of its content height (#412),
 *   and only outwards: nothing is ever posted into the frame.
 */
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { CalloutIcon } from '@/components/editor/nodes/CalloutIcon';
import { CALLOUT_CLASSES } from '@/components/editor/nodes/calloutVariants';
import { buildSrcdoc, frameHeightFromMessage, svgDataUri, FRAME_TOKENS, type FrameTheme, type LiveBlockKind } from '@/lib/liveBlocks';
import { cn } from '@/lib/utils';

interface LiveBlockPreviewProps {
  kind: LiveBlockKind;
  source: string;
  /** An html block's frame reported how tall its content is. */
  onHeight?: (height: number) => void;
}

type MermaidResult = { source: string; dark: boolean; svg: string } | { source: string; dark: boolean; error: string };

let renderCount = 0;

export function LiveBlockPreview({ kind, source, onHeight }: LiveBlockPreviewProps) {
  if (kind === 'svg') {
    return (
      <div className="p-4">
        <img alt="SVG preview" src={svgDataUri(source)} />
      </div>
    );
  }
  if (kind === 'html') return <HtmlPreview source={source} onHeight={onHeight} />;
  return <MermaidPreview source={source} />;
}

// The theme is the `dark` class on <html> (useThemePreference); the editor's font is an
// attribute of <html> too (useEditorAppearance).
function subscribeToRootAttributes(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true });
  return () => observer.disconnect();
}

const isDarkTheme = () => document.documentElement.classList.contains('dark');

/** The look of the note around an html block's frame (#420), read where the frame sits. */
function frameTheme(frame: HTMLIFrameElement): FrameTheme {
  const root = getComputedStyle(document.documentElement);
  // The frame element inherits the font of the content around it.
  const { fontFamily, fontSize, lineHeight } = getComputedStyle(frame);
  // The computed line height is in pixels: the page gets the ratio, for its own font sizes.
  const ratio = parseFloat(lineHeight) / parseFloat(fontSize);
  return {
    colorScheme: isDarkTheme() ? 'dark' : 'light',
    tokens: Object.fromEntries(FRAME_TOKENS.map((name) => [name, root.getPropertyValue(name).trim()])) as FrameTheme['tokens'],
    fontFamily,
    lineHeight: Number.isFinite(ratio) ? String(Math.round(ratio * 1000) / 1000) : 'normal',
  };
}

function HtmlPreview({ source, onHeight }: Pick<LiveBlockPreviewProps, 'source' | 'onHeight'>) {
  // State, not a ref: the frame's document takes its look from the mounted element.
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  // Rebuilt when the look changes, which reloads the page in the frame. Nothing is posted into it.
  const srcDoc = useSyncExternalStore(
    subscribeToRootAttributes,
    () => (frame ? buildSrcdoc(source, frameTheme(frame)) : undefined),
    () => undefined,
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const height = frameHeightFromMessage(event, frame?.contentWindow ?? null);
      if (height !== null) onHeight?.(height);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frame, onHeight]);

  // No background: the page inside is see-through, so the note shows behind it.
  return (
    <iframe
      ref={setFrame}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
      loading="lazy"
      title="HTML preview"
      className="block size-full"
    />
  );
}

// Pie slice tints in sixths of the range from the lightest to the strongest.
const PIE_STEPS = [0, 2, 4, 6, 1, 3, 5];

/**
 * Journal's theme tokens as variables for mermaid's `base` theme, which derives
 * the rest of its palette from them. Mermaid can only do that from hex, rgb or
 * hsl colours, which is what the tokens in src/index.css are.
 */
function mermaidThemeVariables(dark: boolean) {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  // A diagram sits straight on the note (#420), so its surface is the note's background.
  const surface = token('--background');
  const text = token('--foreground');
  // The strongest slice tint its label (in the text colour) still reads on, at 4.5:1.
  const strongest = dark ? 36 : 50;
  return {
    darkMode: dark,
    fontFamily: token('--font-sans'),
    fontSize: '14px',
    background: surface,
    edgeLabelBackground: surface,
    primaryColor: token('--secondary'),
    primaryTextColor: text,
    primaryBorderColor: token('--muted-foreground'),
    secondaryColor: token('--accent'),
    tertiaryColor: token('--background'),
    lineColor: token('--muted-foreground'),
    noteBkgColor: token('--accent'),
    noteTextColor: text,
    noteBorderColor: token('--border'),
    // Mermaid tells pie slices apart by rotating the hue of the colours above, which
    // does nothing to neutrals. Shades of the text colour on the surface do: the first
    // four a wide step apart, then the three between them, then over again.
    ...Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`pie${i + 1}`, `color-mix(in srgb, ${text} ${Math.round(10 + (PIE_STEPS[i % PIE_STEPS.length] * (strongest - 10)) / 6)}%, ${surface})`]),
    ),
    pieTitleTextColor: text,
    pieSectionTextColor: text,
    pieLegendTextColor: text,
    pieOpacity: '1',
    pieStrokeColor: surface,
    pieOuterStrokeColor: token('--border'),
  };
}

function MermaidPreview({ source }: { source: string }) {
  const baseId = `mermaid-${useId().replace(/:/g, '')}`;
  const dark = useSyncExternalStore(subscribeToRootAttributes, isDarkTheme, isDarkTheme);
  const [result, setResult] = useState<MermaidResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `${baseId}-${renderCount++}`;
    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        // Mermaid sizes each node from its measured label, so the label font must be loaded.
        await document.fonts.ready;
        // `classic` is mermaid's flat look: no gradient borders or drop shadows.
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          look: 'classic',
          theme: 'base',
          themeVariables: mermaidThemeVariables(dark),
        });
        const { svg } = await mermaid.render(id, source);
        if (!cancelled) setResult({ source, dark, svg });
      } catch (err) {
        // mermaid leaves its error diagram attached to <body> on a parse failure.
        document.getElementById(`d${id}`)?.remove();
        if (!cancelled) setResult({ source, dark, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseId, source, dark]);

  // Ignore a result computed for an older source or theme while the new render runs.
  const current = result?.source === source && result.dark === dark ? result : null;

  if (!current) {
    return (
      <div role="status" className="flex min-h-24 items-center justify-center p-4 text-sm text-muted-foreground">
        Rendering diagram…
      </div>
    );
  }
  if ('error' in current) {
    return (
      <div role="alert" className={cn('m-4 flex gap-2 rounded-md border-l-4 px-3 py-2 text-sm', CALLOUT_CLASSES.error)}>
        <CalloutIcon variant="error" className="mt-0.5" />
        <div className="min-w-0">
          <div className="font-medium">Couldn’t render this diagram. Check its syntax.</div>
          {/* Mermaid points at the failing column with a caret on its own line: keep the line breaks and a fixed pitch. */}
          <div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{current.error}</div>
        </div>
      </div>
    );
  }
  // The svg's size and centring are in src/index.css ("Live blocks").
  return <div className="custom-scrollbar flex overflow-x-auto p-4" dangerouslySetInnerHTML={{ __html: current.svg }} />;
}
