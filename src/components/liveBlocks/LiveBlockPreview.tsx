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
 *   box. The source is untrusted (an LLM or a collaborator can write it):
 *   `sandbox="allow-scripts"` alone gives the frame an opaque origin, so it
 *   cannot reach the app's DOM, storage or cookies, and the CSP from
 *   buildSrcdoc keeps it off the network. Never add another sandbox token;
 *   e2e/editor/live-html-sandbox.spec.ts holds the proof.
 */
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { CalloutIcon } from '@/components/editor/nodes/CalloutIcon';
import { CALLOUT_CLASSES } from '@/components/editor/nodes/calloutVariants';
import { buildSrcdoc, svgDataUri, type LiveBlockKind } from '@/lib/liveBlocks';
import { cn } from '@/lib/utils';

interface LiveBlockPreviewProps {
  kind: LiveBlockKind;
  source: string;
}

type MermaidResult = { source: string; dark: boolean; svg: string } | { source: string; dark: boolean; error: string };

let renderCount = 0;

export function LiveBlockPreview({ kind, source }: LiveBlockPreviewProps) {
  if (kind === 'svg') {
    return (
      <div className="p-4">
        <img alt="SVG preview" src={svgDataUri(source)} />
      </div>
    );
  }
  if (kind === 'html') {
    // White like a browser tab in both themes: the page inside cannot see the app's theme.
    return (
      <iframe
        sandbox="allow-scripts"
        srcDoc={buildSrcdoc(source)}
        referrerPolicy="no-referrer"
        loading="lazy"
        title="HTML preview"
        className="block size-full bg-white"
      />
    );
  }
  return <MermaidPreview source={source} />;
}

// The theme is the `dark` class on <html> (useThemePreference).
function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

const isDarkTheme = () => document.documentElement.classList.contains('dark');

/**
 * Journal's theme tokens as variables for mermaid's `base` theme, which derives
 * the rest of its palette from them. Mermaid can only do that from hex, rgb or
 * hsl colours, which is what the tokens in src/index.css are.
 */
function mermaidThemeVariables(dark: boolean) {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  const surface = token('--card');
  const text = token('--foreground');
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
    // does nothing to neutrals. Shades of the text colour on the surface do.
    ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`pie${i + 1}`, `color-mix(in srgb, ${text} ${8 + (i % 6) * 6}%, ${surface})`])),
    pieOpacity: '1',
    pieStrokeColor: surface,
    pieOuterStrokeColor: token('--border'),
  };
}

function MermaidPreview({ source }: { source: string }) {
  const baseId = `mermaid-${useId().replace(/:/g, '')}`;
  const dark = useSyncExternalStore(subscribeToTheme, isDarkTheme, isDarkTheme);
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
