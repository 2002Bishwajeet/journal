/**
 * React node view for the link preview card (#173). An editable card without a
 * title fetches its preview once while online and writes it into the node's
 * attrs (so it syncs to other devices); read-only editors never fetch or write.
 * An offline card fills in on its next mount while online.
 */
import { useEffect, useState } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { ExternalLink, Link2 } from 'lucide-react';
import { useDotYouClientContext } from '@/components/auth';
import { fetchLinkPreview } from '@/hooks/links/useLinkPreviewFetch';
import { isPreviewableUrl, type LinkPreviewAttrs } from '@/lib/editor/linkPreview';
import { cn } from '@/lib/utils';

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function LinkPreviewNodeView({ node, editor, updateAttributes, getPos, selected }: NodeViewProps) {
  const dotYouClient = useDotYouClientContext();
  const { url, title, description, image } = node.attrs as LinkPreviewAttrs;
  const [failed, setFailed] = useState(false);

  const editable = editor.isEditable;
  const online = navigator.onLine;
  const shouldFetch = !title && editable && online && isPreviewableUrl(url);

  useEffect(() => {
    if (!shouldFetch) return;
    let cancelled = false;
    fetchLinkPreview(dotYouClient, url)
      .then((result) => {
        if (cancelled) return;
        if (result) updateAttributes(result);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [shouldFetch, dotYouClient, url, updateAttributes]);

  const host = hostnameOf(url);
  const state = title ? 'ready' : shouldFetch && !failed ? 'loading' : 'empty';

  const convert = () => {
    const pos = getPos();
    if (typeof pos === 'number') editor.chain().focus().convertLinkPreviewToLink(pos).run();
  };

  const actionClass =
    'flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground';

  return (
    <NodeViewWrapper
      data-link-preview=""
      data-url={url}
      data-drag-handle
      className={cn(
        'my-2 flex overflow-hidden rounded-lg border bg-card text-card-foreground',
        'flex-col min-[481px]:flex-row',
        selected && 'ring-2 ring-ring',
      )}
    >
      {state === 'ready' && image && (
        <img
          src={image}
          alt=""
          draggable={false}
          className="h-40 w-full shrink-0 object-cover min-[481px]:h-auto min-[481px]:w-40"
        />
      )}
      <div className="flex min-w-0 flex-1 items-start gap-1 p-3">
        <div className="min-w-0 flex-1">
          {state === 'ready' && (
            <>
              <div className="truncate font-medium">{title}</div>
              {description && (
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{description}</p>
              )}
              <div className="mt-1 truncate text-xs text-muted-foreground">{host}</div>
            </>
          )}
          {state === 'loading' && (
            <>
              <div className="truncate text-xs text-muted-foreground">{host}</div>
              <div aria-hidden className="mt-2 h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div aria-hidden className="mt-1.5 h-3 w-1/2 animate-pulse rounded bg-muted" />
            </>
          )}
          {state === 'empty' && (
            <>
              <div className="truncate font-medium">{host}</div>
              <div className="truncate text-sm text-muted-foreground">{url}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {editable && !online ? "Preview will load when you're online" : 'No preview available'}
              </div>
            </>
          )}
        </div>
        <div
          contentEditable={false}
          // Clicking an action must not move the selection onto the card.
          onMouseDown={(e) => e.preventDefault()}
          className="-my-2 -mr-2 flex shrink-0"
        >
          {isPreviewableUrl(url) && (
            <button
              type="button"
              aria-label="Open link"
              title="Open link"
              className={actionClass}
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            >
              <ExternalLink className="h-4 w-4" />
            </button>
          )}
          {editable && (
            <button type="button" aria-label="Convert to link" title="Convert to link" className={actionClass} onClick={convert}>
              <Link2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
