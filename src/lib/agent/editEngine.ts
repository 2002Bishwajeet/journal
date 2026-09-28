/**
 * Headless markdown -> Yjs edit engine for agent writes (#166).
 *
 * Untouched blocks are NEVER rebuilt from markdown: existing content is read
 * into ProseMirror straight from Yjs, only new/changed blocks come from
 * markdown, and `updateYFragment` writes the difference. So every untouched
 * block keeps its Yjs items (note links, image layout attrs included) and
 * concurrent edits elsewhere merge as normal CRDT updates.
 */
import * as Y from 'yjs';
import { getSchema } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { prosemirrorToYXmlFragment, updateYFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { fragmentToMarkdown } from '@/lib/yjs/fragmentToMarkdown';

const FRAGMENT = 'prosemirror';

const extensions = createBaseExtensions();

export const editorSchema = getSchema(extensions);

const md = new MarkdownManager({ extensions });

function parseMarkdown(markdown: string): PMNode {
  return editorSchema.nodeFromJSON(md.parse(markdown));
}

export function toMarkdown(doc: Y.Doc): string {
  return fragmentToMarkdown(doc.getXmlFragment(FRAGMENT));
}

function read(doc: Y.Doc): PMNode {
  return yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), editorSchema);
}

function write(doc: Y.Doc, pmDoc: PMNode): void {
  const fragment = doc.getXmlFragment(FRAGMENT);
  doc.transact(() => updateYFragment(doc, fragment, pmDoc, { mapping: new Map(), isOMark: new Map() }), 'agent');
}

export function appendMarkdown(doc: Y.Doc, markdown: string): void {
  const current = read(doc);
  const added = parseMarkdown(markdown);
  const first = current.firstChild;
  const isEmpty = current.childCount === 1 && first?.type.name === 'paragraph' && first.content.size === 0;
  write(doc, isEmpty ? current.copy(added.content) : current.copy(current.content.append(added.content)));
}

/** Markdown of one top-level block, via the same serializer as `toMarkdown`. */
function blockToMarkdown(block: PMNode): string {
  const tmp = new Y.Doc();
  return fragmentToMarkdown(prosemirrorToYXmlFragment(editorSchema.topNodeType.create(null, block), tmp.getXmlFragment(FRAGMENT)));
}

const hasLossyNode = (block: PMNode) => {
  let found = false;
  block.descendants((n) => {
    if (n.type.name === 'noteLink' || n.type.name === 'image') found = true;
    return !found;
  });
  return found;
};

/**
 * `str_replace` over the markdown of the top-level blocks. Only the contiguous
 * blocks the single match spans are re-parsed from markdown; every other block
 * stays the original ProseMirror node read from Yjs.
 */
export function replaceInNote(doc: Y.Doc, oldText: string, newText: string): void {
  const current = read(doc);
  const blocks: PMNode[] = [];
  current.forEach((b) => blocks.push(b));
  const mds = blocks.map(blockToMarkdown);
  const joined = mds.join('\n\n');

  const count = oldText ? joined.split(oldText).length - 1 : 0;
  if (count === 0) throw new Error('replace_in_note: old_text not found');
  if (count > 1) throw new Error(`replace_in_note: old_text matches ${count} times; include more surrounding text`);

  const at = joined.indexOf(oldText);
  const end = at + oldText.length;
  let from = -1;
  let to = -1;
  let rangeStart = 0;
  let rangeEnd = 0;
  let offset = 0;
  mds.forEach((m, i) => {
    const s = offset;
    const e = offset + m.length;
    if (s <= end && at <= e) {
      if (from < 0) {
        from = i;
        rangeStart = s;
      }
      to = i;
      rangeEnd = e;
    }
    offset = e + 2; // '\n\n' separator
  });

  if (blocks.slice(from, to + 1).some(hasLossyNode)) {
    throw new Error('replace_in_note: the matched text is in a block with a note link or image; edit a different span');
  }

  const rangeMd = joined.slice(rangeStart, rangeEnd);
  const replaced = rangeMd.slice(0, at - rangeStart) + newText + rangeMd.slice(end - rangeStart);
  const next: PMNode[] = [...blocks.slice(0, from)];
  parseMarkdown(replaced).forEach((n) => next.push(n));
  next.push(...blocks.slice(to + 1));
  write(doc, current.copy(Fragment.fromArray(next)));
}

/**
 * A fresh doc built from markdown. LOSSY for note links and image layout, so
 * only for new notes, never for rewriting existing ones.
 */
export function createDoc(markdown: string): Y.Doc {
  const doc = new Y.Doc();
  write(doc, parseMarkdown(markdown));
  return doc;
}
