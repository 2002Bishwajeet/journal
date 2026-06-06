/**
 * React node view for the internal note-link node. The displayed title is
 * resolved live from NoteLinkContext, so renaming a note updates every link to
 * it; a missing target renders muted and non-clickable.
 */
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useNoteLinkContext } from "../NoteLinkContext";

export function NoteLinkNodeView({ node }: NodeViewProps) {
  const ctx = useNoteLinkContext();
  const noteId = (node.attrs.noteId as string | null) ?? "";
  const label = (node.attrs.label as string) || "note";

  const resolved = noteId ? ctx?.resolve(noteId) : undefined;
  // Broken only once the title map has loaded and the target is genuinely absent
  // (deleted / archived / foreign id). While loading, show the label, not ⚠.
  const broken = !!noteId && !!ctx && ctx.isReady && !resolved;
  const display = resolved?.title ?? label;

  return (
    <NodeViewWrapper as="span" className="note-link-wrapper">
      <button
        type="button"
        contentEditable={false}
        data-note-id={noteId}
        className={broken ? "note-link note-link--broken" : "note-link"}
        title={broken ? "Note not found" : display}
        onClick={() => {
          if (!broken && noteId) ctx?.onNavigate(noteId);
        }}
      >
        {broken ? `⚠ ${label}` : display}
      </button>
    </NodeViewWrapper>
  );
}
