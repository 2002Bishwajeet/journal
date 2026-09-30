/**
 * React node view for code blocks. A non-live language renders the same
 * `pre > code` as the headless node. A `mermaid` or `svg` block adds a
 * Preview / Code toggle; the toggle is view state and is never stored in the
 * document. The code stays mounted (hidden) in Preview so ProseMirror keeps
 * its content DOM.
 */
import { useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { LiveBlockPreview } from '@/components/liveBlocks/LiveBlockPreview';
import { liveBlockKind } from '@/lib/liveBlocks';

const TOGGLE_BUTTON = 'rounded-sm px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent aria-pressed:bg-accent aria-pressed:text-foreground';

export function CodeBlockNodeView({ node }: NodeViewProps) {
  const language = node.attrs.language as string | null;
  const kind = liveBlockKind(language);
  // Preview when the block has content at mount, Code when it is empty.
  const [showPreview, setShowPreview] = useState(() => node.textContent.length > 0);
  const preview = kind !== null && showPreview;

  return (
    <NodeViewWrapper data-live-block={kind ?? undefined}>
      {kind && (
        <div contentEditable={false} className="mb-1 flex justify-end gap-1">
          <button type="button" aria-pressed={preview} onClick={() => setShowPreview(true)} className={TOGGLE_BUTTON}>
            Preview
          </button>
          <button type="button" aria-pressed={!preview} onClick={() => setShowPreview(false)} className={TOGGLE_BUTTON}>
            Code
          </button>
        </div>
      )}
      {kind && preview && (
        <div contentEditable={false} data-live-block-preview="" className="my-2 rounded-md border bg-secondary p-4">
          <LiveBlockPreview kind={kind} source={node.textContent} />
        </div>
      )}
      <pre hidden={preview}>
        <NodeViewContent<'code'> as="code" className={language ? `language-${language}` : undefined} style={{ whiteSpace: 'inherit' }} />
      </pre>
    </NodeViewWrapper>
  );
}
