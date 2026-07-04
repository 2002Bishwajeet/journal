/**
 * Internal note-link node (`[[`).
 *
 * Inline atom carrying the stable target `noteId` plus a `label` snapshot
 * (used for plain-text/export and as the fallback when the target can't be
 * resolved). The displayed title is resolved live (see NoteLinkNodeView), so
 * renaming a note updates every link to it.
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { NoteLinkNodeView } from "./NoteLinkNodeView";

export interface NoteLinkAttributes {
  noteId: string | null;
  label: string;
}

export const NoteLink = Node.create({
  name: "noteLink",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-note-id"),
        renderHTML: (attrs) =>
          attrs.noteId ? { "data-note-id": attrs.noteId } : {},
      },
      label: {
        default: "",
        parseHTML: (el) =>
          el.getAttribute("data-label") || el.textContent || "",
        // label is carried via the element's text content, not a separate attr
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "a[data-note-id]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "a",
      mergeAttributes(HTMLAttributes, {
        "data-note-id": node.attrs.noteId,
        "data-label": node.attrs.label,
        class: "note-link",
      }),
      node.attrs.label || "note",
    ];
  },

  renderText({ node }) {
    return node.attrs.label || "";
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteLinkNodeView);
  },
});
