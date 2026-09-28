/**
 * Schema-only image extension: node attrs for pending uploads, float alignment
 * and drag-resized width. No node view — the editor layers one on top (see
 * editorExtensions.ts) so headless code (the agent edit engine, #316) can
 * build the schema without pulling in React.
 */
import Image from "@tiptap/extension-image";
import { ALIGN_STYLE, type ImageAlign } from "./imageLayout";

export const ImageSchema = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      "data-pending-id": {
        default: null,
        parseHTML: element => element.getAttribute("data-pending-id"),
        renderHTML: attributes => {
          if (!attributes["data-pending-id"]) return {};
          return { "data-pending-id": attributes["data-pending-id"] };
        },
      },
      // Float alignment, set from the toolbar that appears on a selected
      // image. Distinct from the paragraph's TextAlign, which only shifts
      // the image within its line — a float lets the text wrap around it.
      align: {
        default: null,
        parseHTML: element => element.getAttribute("data-align"),
        renderHTML: attributes => {
          const css = ALIGN_STYLE[attributes.align as ImageAlign];
          if (!css) return {};
          return {
            "data-align": attributes.align,
            style: Object.entries(css).map(([k, v]) => `${k}: ${v}`).join("; "),
          };
        },
      },
      // Rendered width in px, set by dragging one of the image's corner
      // handles. Lives on the node, so it persists in the Yjs doc like any
      // other attr. No height: leaving it auto keeps the aspect ratio.
      width: {
        default: null,
        parseHTML: element => {
          const w = parseInt(element.style.width || element.getAttribute("width") || "", 10);
          return Number.isFinite(w) ? w : null;
        },
        renderHTML: attributes => {
          if (!attributes.width) return {};
          return { style: `width: ${attributes.width}px` };
        },
      },
    };
  },
}).configure({
  inline: true,
  allowBase64: true,
});
