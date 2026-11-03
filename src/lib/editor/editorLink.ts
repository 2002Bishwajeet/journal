import { getMarkRange, type Editor } from '@tiptap/core';

/** What the link sheet edits: the text range, its text and the link it already has (if any). */
export interface LinkTarget {
  from: number;
  to: number;
  text: string;
  href: string;
}

/** The link under the caret (whole link), else the selected text. */
export function getLinkTarget(editor: Editor): LinkTarget {
  const { doc, selection, schema } = editor.state;
  const href = (editor.getAttributes('link').href as string | undefined) ?? '';
  const linkRange = href ? getMarkRange(selection.$from, schema.marks.link) : undefined;
  const { from, to } = selection.empty && linkRange ? linkRange : selection;
  return { from, to, text: doc.textBetween(from, to), href };
}

/** A URL with no scheme (`example.com`) would be a relative link: make it `https://`. */
export function normalizeHref(url: string): string {
  const trimmed = url.trim();
  return /^([a-z][a-z0-9+.-]*:|[/#?])/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Link `text` to `url` in place of the target range. Unchanged text keeps its other marks. */
export function applyLink(editor: Editor, target: LinkTarget, text: string, url: string): void {
  const href = normalizeHref(url);
  const label = text || target.text || href;
  if (label === target.text && target.from !== target.to) {
    editor.chain().setTextSelection({ from: target.from, to: target.to }).setLink({ href }).run();
  } else {
    editor
      .chain()
      .insertContentAt(
        { from: target.from, to: target.to },
        { type: 'text', text: label, marks: [{ type: 'link', attrs: { href } }] },
      )
      .run();
  }
}

export function removeLink(editor: Editor, target: LinkTarget): void {
  editor.chain().setTextSelection({ from: target.from, to: target.to }).unsetLink().run();
}
