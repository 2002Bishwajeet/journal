/**
 * React node view for code blocks. A non-live language renders the same
 * `pre > code` as the headless node. A `mermaid`, `svg` or `html` block puts it
 * in a LiveBlockFrame with a Preview / Code toggle; the toggle is view state
 * and is never stored in the document. The code stays mounted (hidden) in
 * Preview so ProseMirror keeps its content DOM.
 */
import { useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { LiveBlockFrame, LiveBlockToggle } from '@/components/liveBlocks/LiveBlockFrame';
import { liveBlockKind } from '@/lib/liveBlocks';

export function CodeBlockNodeView({ node, selected }: NodeViewProps) {
  const language = node.attrs.language as string | null;
  const kind = liveBlockKind(language);
  // Preview when the block has content at mount, Code when it is empty.
  const [showPreview, setShowPreview] = useState(() => node.textContent.length > 0);
  const preview = kind !== null && showPreview;

  const code = (
    <pre hidden={preview}>
      <NodeViewContent<'code'> as="code" className={language ? `language-${language}` : undefined} style={{ whiteSpace: 'inherit' }} />
    </pre>
  );

  return (
    <NodeViewWrapper>
      {kind ? (
        <LiveBlockFrame
          kind={kind}
          source={node.textContent}
          preview={preview}
          selected={selected}
          labelled
          toggles={
            <>
              <LiveBlockToggle pressed={preview} onClick={() => setShowPreview(true)}>
                Preview
              </LiveBlockToggle>
              <LiveBlockToggle pressed={!preview} onClick={() => setShowPreview(false)}>
                Code
              </LiveBlockToggle>
            </>
          }
        >
          {code}
        </LiveBlockFrame>
      ) : (
        code
      )}
    </NodeViewWrapper>
  );
}
