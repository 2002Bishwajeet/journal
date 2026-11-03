/**
 * Renders the preview of a live block (code block whose language is `mermaid`,
 * `svg`, `html` or `react`) inside LiveBlockFrame, which the editor and the
 * share page both use.
 *
 * - mermaid: drawn inside the same frame as an html block (#946), by a mermaid
 *   runtime that vite.config.ts builds into a script inlined in the frame's
 *   srcdoc. Nothing mermaid makes reaches the app's DOM. The app only hands the
 *   page the source and, over the port below, the theme: a new theme redraws the
 *   diagram on that page, which does not reload. A parse error is shown on the
 *   page, and the error of a runtime that can't load is shown as text.
 * - svg: shown through an <img> data URI, so the source is never injected into
 *   the DOM and its scripts never run.
 * - html: runs in a sandboxed srcdoc frame that fills the frame's resizable
 *   box and takes the note's colours and font through buildSrcdoc (#420).
 *   The source is untrusted (an LLM or a collaborator can write it):
 *   `sandbox="allow-scripts"` alone gives the frame an opaque origin, so it
 *   cannot reach the app's DOM, storage or cookies, and the CSP from
 *   buildSrcdoc lets it load scripts, styles and fonts from three CDN hosts
 *   and reach nothing else on the network. The app's enforced `frame-src` keeps
 *   it from navigating itself to a page without that CSP. Never add another
 *   sandbox token; e2e/editor/live-html-sandbox.spec.ts holds the proof. Three
 *   things cross the boundary: the frame's report of its content height (#412),
 *   the block's `journal.storage` requests for its own saved state (#410), which
 *   the app answers from `store`, and a clicked web link, which the app opens in
 *   a new tab. All three go over a port only the page built here can hand the
 *   app (#945); nothing that arrives on the window is answered.
 * - react: the JSX is compiled in the app by the lazily imported
 *   reactBlockCompiler, then runs in the same frame as an html block, on the
 *   app's own React: vite.config.ts builds it into a script that is inlined in
 *   the frame's srcdoc, so nothing comes from the network (#426). The same goes
 *   for its Tailwind sheet and the libraries it may import (#427); classes the
 *   sheet lacks are compiled for the block along with its JSX (#559). A compile
 *   error is shown as text in place of the frame.
 */
import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CalloutIcon } from '@/components/editor/nodes/CalloutIcon';
import { CALLOUT_CLASSES } from '@/components/editor/nodes/calloutVariants';
import {
  bridgePortFromMessage,
  buildSrcdoc,
  frameHeightFromMessage,
  frameRootStyle,
  linkFromMessage,
  mermaidBlockDocument,
  reactBlockDocument,
  svgDataUri,
  FRAME_TOKENS,
  MIN_FRAME_HEIGHT,
  type FrameTheme,
  type LiveBlockKind,
} from '@/lib/liveBlocks';
import type { ReactBlockLibrary } from '@/lib/reactBlockLibraries';
import { createBlockStateSession, memoryBlockStateStore, replyToStorageMessage, type BlockStateStore } from '@/lib/liveBlockState';
import { cn } from '@/lib/utils';

interface LiveBlockPreviewProps {
  kind: LiveBlockKind;
  source: string;
  /** Where an html or react block's saved state is kept; without one it lasts while the preview is shown. */
  store?: BlockStateStore;
  /** An html or react block's preview reported how tall its content is. */
  onHeight?: (height: number) => void;
  /** A `wide` html or react block, which may be taller (#557). */
  wide?: boolean;
}

type ReactResult = { source: string; page: string } | { source: string; title: string; error: string };

export function LiveBlockPreview({ kind, source, store, onHeight, wide }: LiveBlockPreviewProps) {
  if (kind === 'svg') {
    return (
      <div className="p-4">
        <img alt="SVG preview" src={svgDataUri(source)} />
      </div>
    );
  }
  if (kind === 'html') return <HtmlPreview source={source} title="HTML preview" store={store} onHeight={onHeight} wide={wide} />;
  if (kind === 'react') return <ReactPreview source={source} store={store} onHeight={onHeight} wide={wide} />;
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

function HtmlPreview({
  source,
  title,
  store,
  onHeight,
  wide,
  themeVariables,
}: Pick<LiveBlockPreviewProps, 'source' | 'store' | 'onHeight' | 'wide'> & { title: string; themeVariables?: string }) {
  // State, not a ref: the frame's document takes its look from the mounted element.
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null);
  // What the app knows the frame's own page by (#945). It stays the same through a reload of that page.
  const [bridgeToken] = useState(() => crypto.randomUUID());
  // Rebuilt when the look changes, which reloads the page in the frame.
  const currentDoc = useSyncExternalStore(
    subscribeToRootAttributes,
    () => (frame ? buildSrcdoc(source, frameTheme(frame), bridgeToken) : undefined),
    () => undefined,
  );
  // A page with `themeVariables` keeps the document it loaded, and redraws for a new look (below).
  const [firstDoc, setFirstDoc] = useState(currentDoc);
  if (currentDoc && !firstDoc) setFirstDoc(currentDoc);
  const srcDoc = themeVariables === undefined ? currentDoc : firstDoc;

  // The block's saved state is kept by the app, not the frame, so a reload of the frame keeps it.
  const [session] = useState(createBlockStateSession);
  const [memoryStore] = useState(() => memoryBlockStateStore(undefined));
  const blockStore = store ?? memoryStore;
  useEffect(() => () => session.flush(), [session]);

  // Each page in the frame hands over a port of its own as it starts to load. In a layout effect,
  // so this listens before the page that commits with `frame` can run.
  const [port, setPort] = useState<MessagePort | null>(null);
  useLayoutEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const next = bridgePortFromMessage(event, frame?.contentWindow ?? null, bridgeToken);
      if (next) setPort(next);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frame, bridgeToken]);

  useEffect(() => {
    if (!port) return;
    const onMessage = ({ data }: MessageEvent<unknown>) => {
      const height = frameHeightFromMessage(data, wide);
      if (height !== null) onHeight?.(height);
      const link = linkFromMessage(data);
      if (link) window.open(link, '_blank', 'noopener,noreferrer');
      const reply = replyToStorageMessage(data, session, blockStore);
      if (reply) port.postMessage(reply);
    };
    port.addEventListener('message', onMessage);
    port.start();
    return () => port.removeEventListener('message', onMessage);
  }, [port, onHeight, session, blockStore, wide]);

  useEffect(() => {
    if (!port || !frame || themeVariables === undefined) return;
    port.postMessage({ journalLiveBlock: 1, look: { style: frameRootStyle(frameTheme(frame)), themeVariables } });
  }, [port, frame, themeVariables]);

  // No background: the page inside is see-through, so the note shows behind it.
  return (
    <iframe
      ref={setFrame}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
      loading="lazy"
      title={title}
      // Over the box's padding too: its bleed (LiveBlockFrame).
      className="absolute inset-0 block size-full"
    />
  );
}

/** The script of each library a react block can import (REACT_BLOCK_LIBRARIES), built in vite.config.ts. */
const REACT_BLOCK_LIBRARY_SCRIPTS: Record<ReactBlockLibrary, () => Promise<{ default: string }>> = {
  recharts: () => import('virtual:react-block-recharts'),
  'lucide-react': () => import('virtual:react-block-lucide'),
  d3: () => import('virtual:react-block-d3'),
  three: () => import('virtual:react-block-three'),
  'lodash-es': () => import('virtual:react-block-lodash'),
  lodash: () => import('virtual:react-block-lodash'),
  mathjs: () => import('virtual:react-block-mathjs'),
  papaparse: () => import('virtual:react-block-papaparse'),
  'journal-ui': () => import('virtual:react-block-ui'),
};

/**
 * A react block (#426). The compiler, the runtime and the Tailwind sheet load on the first one
 * shown, a library on the first block that imports it (#427); all are cached for offline use
 * by src/sw.ts.
 */
function ReactPreview({ source, store, onHeight, wide }: Pick<LiveBlockPreviewProps, 'source' | 'store' | 'onHeight' | 'wide'>) {
  const [result, setResult] = useState<ReactResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let next: ReactResult;
      try {
        const [{ compileReactBlock, compileBlockTailwind, reactBlockImports }, { default: react }, { default: tailwind }] = await Promise.all([
          import('@/lib/reactBlockCompiler'),
          import('virtual:react-block-runtime'),
          import('virtual:react-block-tailwind'),
        ]);
        const compiled = compileReactBlock(source);
        if ('error' in compiled) {
          next = { source, title: 'Couldn’t compile this component. Check its syntax.', error: compiled.error };
        } else {
          // A library loads only for a block that imports it (#427); `lodash` and `lodash-es` are one script.
          const loads = reactBlockImports(compiled.code).filter((name) => Object.hasOwn(REACT_BLOCK_LIBRARY_SCRIPTS, name));
          const [scripts, blockTailwind] = await Promise.all([
            Promise.all(loads.map((name) => REACT_BLOCK_LIBRARY_SCRIPTS[name as ReactBlockLibrary]().then((module) => module.default))),
            compileBlockTailwind(source),
          ]);
          next = { source, page: reactBlockDocument({ react, tailwind, libraries: [...new Set(scripts)] }, compiled.code, blockTailwind) };
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
  return <HtmlPreview source={current.page} title="React preview" store={store} onHeight={onHeight} wide={wide} />;
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

/** A mermaid block (#946). Its runtime loads on the first one shown and is cached for offline use by src/sw.ts. */
function MermaidPreview({ source }: { source: string }) {
  const dark = useSyncExternalStore(subscribeToRootAttributes, isDarkTheme, isDarkTheme);
  const [runtime, setRuntime] = useState<{ script: string } | { error: string } | null>(null);
  const [height, setHeight] = useState(MIN_FRAME_HEIGHT);

  useEffect(() => {
    let cancelled = false;
    import('virtual:react-block-mermaid').then(
      ({ default: script }) => {
        if (!cancelled) setRuntime({ script });
      },
      // Offline, before any mermaid block was ever shown: the runtime is not cached yet.
      (err: unknown) => {
        if (!cancelled) setRuntime({ error: err instanceof Error ? err.message : String(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (!runtime) {
    return (
      <div role="status" className="flex min-h-24 items-center justify-center p-4 text-sm text-muted-foreground">
        Rendering diagram…
      </div>
    );
  }
  if ('error' in runtime) return <PreviewError title="Couldn’t load Mermaid for this diagram.">{runtime.error}</PreviewError>;
  // The frame reaches FRAME_BLEED past the block on every side, as in LiveBlockFrame's box for an
  // html block. This box is here because a mermaid block's code view must not stay in it; flow-root
  // keeps its margins in. A frame of its own for each source, as only a new theme keeps the page.
  return (
    <div className="flow-root">
      <div className="relative -m-3 box-content! overflow-hidden p-3" style={{ height }}>
        <HtmlPreview
          key={source}
          source={mermaidBlockDocument(runtime.script, source)}
          title="Mermaid preview"
          onHeight={setHeight}
          themeVariables={JSON.stringify(mermaidThemeVariables(dark))}
        />
      </div>
    </div>
  );
}
