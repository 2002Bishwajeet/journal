/**
 * Renders the preview of a live block (code block whose language is `mermaid`
 * or `svg`). Standalone so the share page can reuse it.
 *
 * - mermaid: rendered by the lazily imported mermaid runtime in strict mode.
 *   A parse or load error is shown as text; it never throws to the caller.
 * - svg: shown through an <img> data URI, so the source is never injected into
 *   the DOM and its scripts never run.
 */
import { useEffect, useId, useState } from 'react';
import { svgDataUri, type LiveBlockKind } from '@/lib/liveBlocks';

interface LiveBlockPreviewProps {
  kind: LiveBlockKind;
  source: string;
}

type MermaidResult = { source: string; theme: string; svg: string } | { source: string; theme: string; error: string };

let renderCount = 0;

export function LiveBlockPreview({ kind, source }: LiveBlockPreviewProps) {
  if (kind === 'svg') {
    return <img alt="SVG preview" src={svgDataUri(source)} className="mx-auto max-w-full" />;
  }
  return <MermaidPreview source={source} />;
}

function MermaidPreview({ source }: { source: string }) {
  const baseId = `mermaid-${useId().replace(/:/g, '')}`;
  const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'default';
  const [result, setResult] = useState<MermaidResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = `${baseId}-${renderCount++}`;
    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
        const { svg } = await mermaid.render(id, source);
        if (!cancelled) setResult({ source, theme, svg });
      } catch (err) {
        // mermaid leaves its error diagram attached to <body> on a parse failure.
        document.getElementById(`d${id}`)?.remove();
        if (!cancelled) setResult({ source, theme, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseId, source, theme]);

  // Ignore a result computed for an older source or theme while the new render runs.
  const current = result?.source === source && result.theme === theme ? result : null;

  if (!current) {
    return <p className="text-sm text-muted-foreground">Rendering diagram…</p>;
  }
  if ('error' in current) {
    return (
      <pre role="alert" className="whitespace-pre-wrap text-sm text-destructive">
        {current.error}
      </pre>
    );
  }
  return <div className="flex justify-center overflow-x-auto" dangerouslySetInnerHTML={{ __html: current.svg }} />;
}
