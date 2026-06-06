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
  // Broken = we have a resolver but the target isn't there (deleted/foreign id).
  const broken = !!noteId && !!ctx && !resolved;
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
