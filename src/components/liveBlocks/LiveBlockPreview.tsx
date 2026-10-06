/**
 * Renders the preview of a live block (code block whose language is `mermaid`,
 * `svg`, `html` or `react`) inside LiveBlockFrame, which the editor and the
 * share page both use.
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
 *   buildSrcdoc lets it load scripts, styles and fonts from three CDN hosts
 *   and reach nothing else on the network. Never add another sandbox token;
 *   e2e/editor/live-html-sandbox.spec.ts holds the proof. The one thing that
 *   crosses the boundary is the frame's report of its content height (#412),
 *   and only outwards: nothing is ever posted into the frame.
 * - react: the JSX is compiled in the app by the lazily imported
 *   reactBlockCompiler, then runs in the same frame as an html block, on the
 *   app's own React: vite.config.ts builds it into a script that is inlined in
 *   the frame's srcdoc, so nothing comes from the network (#426). The same goes
 *   for its Tailwind sheet and the libraries it may import (#427). A compile
 *   error is shown as text in place of the frame.
 */
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CalloutIcon } from '@/components/editor/nodes/CalloutIcon';
import { CALLOUT_CLASSES } from '@/components/editor/nodes/calloutVariants';
import {
  buildSrcdoc,
  frameHeightFromMessage,
  reactBlockDocument,
  svgDataUri,
  FRAME_TOKENS,
  MIN_FRAME_HEIGHT,
  type FrameTheme,
  type LiveBlockKind,
} from '@/lib/liveBlocks';
import { cn } from '@/lib/utils';

interface LiveBlockPreviewProps {
  kind: LiveBlockKind;
  source: string;
  /** An html or react block's preview reported how tall its content is. */
  onHeight?: (height: number) => void;
}

type MermaidResult = { source: string; dark: boolean; svg: string } | { source: string; dark: boolean; error: string };
type ReactResult = { source: string; page: string } | { source: string; title: string; error: string };

let renderCount = 0;

export function LiveBlockPreview({ kind, source, onHeight }: LiveBlockPreviewProps) {
  if (kind === 'svg') {
    return (
      <div className="p-4">
        <img alt="SVG preview" src={svgDataUri(source)} />
      </div>
    );
  }
  if (kind === 'html') return <HtmlPreview source={source} title="HTML preview" onHeight={onHeight} />;
  if (kind === 'react') return <ReactPreview source={source} onHeight={onHeight} />;
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

function HtmlPreview({ source, title, onHeight }: Pick<LiveBlockPreviewProps, 'source' | 'onHeight'> & { title: string }) {
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
      title={title}
      className="block size-full"
    />
  );
}

/**
 * A react block (#426). The compiler, the runtime and the Tailwind sheet load on the first one
 * shown, a library on the first block that imports it (#427); all are cached for offline use
 * by src/sw.ts.
 */
function ReactPreview({ source, onHeight }: Pick<LiveBlockPreviewProps, 'source' | 'onHeight'>) {
  const [result, setResult] = useState<ReactResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: ReactResult;
      try {
        const [{ compileReactBlock, reactBlockImports }, { default: react }, { default: tailwind }] = await Promise.all([
          import('@/lib/reactBlockCompiler'),
          import('virtual:react-block-runtime'),
          import('virtual:react-block-tailwind'),
        ]);
        const compiled = compileReactBlock(source);
        if ('error' in compiled) {
          next = { source, title: 'Couldn’t compile this component. Check its syntax.', error: compiled.error };
        } else {
          // A library loads only for a block that imports it (#427).
          const lucide = reactBlockImports(compiled.code).includes('lucide-react') ? (await import('virtual:react-block-lucide')).default : undefined;
          next = { source, page: reactBlockDocument({ react, tailwind, lucide }, compiled.code) };
        }
      } catch (err) {
        // Offline, before any react block was ever shown: the compiler and runtime are not cached yet.
        next = { source, title: 'Couldn’t load React for this component.', error: err instanceof Error ? err.message : String(err) };
      }
      if (!cancelled) setResult(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  // Ignore a result compiled from an older source while the new one compiles.
  const current = result?.source === source ? result : null;

  if (!current) {
    return (
      <div role="status" className="flex min-h-24 items-center justify-center p-4 text-sm text-muted-foreground">
        Loading component…
      </div>
    );
  }
  if ('error' in current) {
    // No frame reports a height here, so the block's box fits the message (flow-root keeps its margins in).
    const fitMessage = (el: HTMLDivElement | null) => {
      if (el) onHeight?.(Math.max(el.offsetHeight, MIN_FRAME_HEIGHT));
    };
    return (
      <div ref={fitMessage} className="flow-root">
        <PreviewError title={current.title}>{current.error}</PreviewError>
      </div>
    );
  }
  return <HtmlPreview source={current.page} title="React preview" onHeight={onHeight} />;
}

/** A preview that could not be made, as the app's error callout. */
function PreviewError({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="alert" className={cn('m-4 flex gap-2 rounded-md border-l-4 px-3 py-2 text-sm', CALLOUT_CLASSES.error)}>
      <CalloutIcon variant="error" className="mt-0.5" />
      <div className="min-w-0">
        <div className="font-medium">{title}</div>
        {/* Mermaid points at the failing column with a caret on its own line: keep the line breaks and a fixed pitch. */}
        <div className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{children}</div>
      </div>
    </div>
  );
}

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
  const chart = [1, 2, 3, 4, 5].map((n) => token(`--chart-${n}`));
  // Every chart colour has at least 3:1 contrast with the background (src/__tests__/chartPalette.test.ts),
  // so the background is the label colour that reads on every one of them, in both themes.
  const slots = (prefix: string, from: number, count: number, value: (i: number) => string) =>
    Object.fromEntries(Array.from({ length: count }, (_, i) => [`${prefix}${i + from}`, value(i)]));
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
    // Slices are the theme's chart palette (#424, #430). A pie of more than five goes round
    // it again, each time nearer the text colour, so the labels still read on every slice.
    ...slots('pie', 1, 12, (i) => (i < 5 ? chart[i] : `color-mix(in srgb, ${chart[i % 5]} ${i < 10 ? 60 : 35}%, ${text})`)),
    pieTitleTextColor: text,
    pieSectionTextColor: surface,
    pieLegendTextColor: text,
    pieOpacity: '1',
    pieStrokeColor: surface,
    pieOuterStrokeColor: token('--border'),
    // The other diagrams with a colour per series or section: timeline, radar and treemap
    // (cScale, which mindmap and kanban share), gitGraph branches and xychart plots.
    ...slots('cScale', 0, 12, (i) => chart[i % 5]),
    ...slots('cScaleLabel', 0, 12, () => surface),
    ...slots('git', 0, 8, (i) => chart[i % 5]),
    ...slots('gitBranchLabel', 0, 8, () => surface),
    // Setting xyChart replaces mermaid's whole object, so it repeats the colours the base
    // theme would give the rest of it.
    xyChart: {
      backgroundColor: surface,
      plotColorPalette: chart.join(','),
      ...Object.fromEntries(
        ['title', 'dataLabel', 'legendText', 'xAxisTitle', 'xAxisLabel', 'xAxisTick', 'xAxisLine', 'yAxisTitle', 'yAxisLabel', 'yAxisTick', 'yAxisLine'].map((slot) => [
          `${slot}Color`,
          text,
        ]),
      ),
    },
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
  if ('error' in current) return <PreviewError title="Couldn’t render this diagram. Check its syntax.">{current.error}</PreviewError>;
  // The svg's size and centring are in src/index.css ("Live blocks").
  return <div className="custom-scrollbar flex overflow-x-auto p-4" dangerouslySetInnerHTML={{ __html: current.svg }} />;
}
