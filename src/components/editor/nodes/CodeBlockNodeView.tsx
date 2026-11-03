/**
 * React node view for code blocks. A non-live language renders the same
 * `pre > code` as the headless node. A `mermaid`, `svg`, `html` or `react` block puts it
 * in a LiveBlockFrame with a Preview / Code toggle; the toggle is view state
 * and is never stored in the document. The code stays mounted (hidden) in
 * Preview so ProseMirror keeps its content DOM.
 *
 * The `language` attribute is the fence's whole info string; only its first word
 * is the language. An html or react block's id is in it too (```html id=k3f9),
 * and keys the block's saved state in the note (#410), and so is `wide` (#557).
 * In a note someone else may have written, an html or react block waits for Run (#947).
 */
import { useEffect, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { LiveBlockFrame, LiveBlockToggle } from '@/components/liveBlocks/LiveBlockFrame';
import { liveBlockKind, parseCodeInfo, withBlockId } from '@/lib/liveBlocks';
import { memoryBlockStateStore, newBlockId, ownBlockId, type BlockStateStore } from '@/lib/liveBlockState';
import { holdLiveBlock } from '@/lib/liveBlockRuns';
import { useEditorContext } from '../EditorContext';

export function CodeBlockNodeView({ node, selected, editor, getPos, updateAttributes }: NodeViewProps) {
  const info = node.attrs.language as string | null;
  const { language, wide } = parseCodeInfo(info);
  const kind = liveBlockKind(info);
  const { blockState, liveBlocksTrusted, readOnly } = useEditorContext();
  // Preview when the block has content at mount, Code when it is empty.
  const [showPreview, setShowPreview] = useState(() => node.textContent.length > 0);
  const preview = kind !== null && showPreview;
  const source = node.textContent;

  // The owner's next edit makes the note trusted again; a block seen waiting for Run still waits for it.
  useEffect(() => {
    if (preview && (kind === 'html' || kind === 'react') && !liveBlocksTrusted) void holdLiveBlock(kind, source);
  }, [preview, kind, liveBlocksTrusted, source]);

  // The info string as the document has it now: an id given a moment ago is there before this view re-renders.
  const currentInfo = () => {
    const pos = getPos();
    return pos === undefined ? info : ((editor.state.doc.nodeAt(pos)?.attrs.language as string | null) ?? null);
  };
  // The block's id, or null when it has none of its own: a later block with the same id (a copy) doesn't share its state (#950).
  const ownId = () => {
    const pos = getPos();
    return pos === undefined ? parseCodeInfo(info).id : ownBlockId(editor.state.doc, pos);
  };
  // A block without an id of its own gets one on its first save, in the info string, so the markdown carries it.
  const store: BlockStateStore = {
    read: () => {
      const id = ownId();
      return id ? blockState.get(id) : undefined;
    },
    write: (json) => {
      let id = ownId();
      if (!id) {
        id = newBlockId();
        updateAttributes({ language: withBlockId(currentInfo() ?? '', id) });
      }
      blockState.set(id, json);
    },
    room: () => blockState.room(ownId()),
  };
  // A note the host can only view keeps a viewer's changes in memory, as the share page does: they never reach the note (#950).
  const [viewerStore] = useState(() => memoryBlockStateStore(store.read()));

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
          source={source}
          preview={preview}
          trusted={liveBlocksTrusted}
          selected={selected}
          labelled
          store={readOnly ? viewerStore : store}
          wide={wide}
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
