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
import { getSchema, type JSONContent } from '@tiptap/core';
import { MarkdownManager } from '@tiptap/markdown';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { prosemirrorToYXmlFragment, updateYFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { fragmentToMarkdown } from '@/lib/yjs/fragmentToMarkdown';
import { footnoteOrder, normalizeFootnotes } from '@/lib/editor/footnotes';
import { getNewId } from '@/lib/utils';

const FRAGMENT = 'prosemirror';

const extensions = createBaseExtensions();

export const editorSchema = getSchema(extensions);

const md = new MarkdownManager({ extensions });

/**
 * Markdown -> ProseMirror. A `[^n]` the note already has is that footnote
 * (`existing[n - 1]`); any other label gets a new id. With `newDefinitions`
 * (appended text), a label the markdown defines is always a new footnote.
 */
function parseMarkdown(markdown: string, existing: string[] = [], newDefinitions = false): PMNode {
  const json = md.parse(markdown);
  const footnoteNodes: JSONContent[] = [];
  const collect = (node: JSONContent) => {
    if (node.type === 'footnoteReference' || node.type === 'footnote') footnoteNodes.push(node);
    node.content?.forEach(collect);
  };
  collect(json);
  const defined = new Set(footnoteNodes.filter((n) => n.type === 'footnote').map((n) => String(n.attrs?.id)));
  const ids = new Map<string, string>();
  for (const node of footnoteNodes) {
    const label = String(node.attrs?.id);
    if (!ids.has(label)) {
      const n = /^[1-9]\d*$/.test(label) ? Number(label) : 0;
      const reuse = n > 0 && n <= existing.length && !(newDefinitions && defined.has(label));
      ids.set(label, reuse ? existing[n - 1] : getNewId());
    }
    node.attrs = { ...node.attrs, id: ids.get(label) };
  }
  return editorSchema.nodeFromJSON(json);
}

export function toMarkdown(doc: Y.Doc): string {
  return fragmentToMarkdown(doc.getXmlFragment(FRAGMENT));
}

function read(doc: Y.Doc): PMNode {
  return yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), editorSchema);
}

function write(doc: Y.Doc, pmDoc: PMNode): void {
  const fragment = doc.getXmlFragment(FRAGMENT);
  // The editor's footnotes plugin doesn't run here: put the section in step with the references.
  const tr = new Transform(pmDoc);
  normalizeFootnotes(tr);
  doc.transact(() => updateYFragment(doc, fragment, tr.doc, { mapping: new Map(), isOMark: new Map() }), 'agent');
}

export function appendMarkdown(doc: Y.Doc, markdown: string): void {
  const current = read(doc);
  const added = parseMarkdown(markdown, footnoteOrder(current), true);
  const first = current.firstChild;
  const isEmpty = current.childCount === 1 && first?.type.name === 'paragraph' && first.content.size === 0;
  write(doc, isEmpty ? current.copy(added.content) : current.copy(current.content.append(added.content)));
}

/** Markdown of one top-level block, via the same serializer as `toMarkdown`, with the note's footnote `numbers`. */
function blockToMarkdown(block: PMNode, numbers: Map<string, number>): string {
  const tmp = new Y.Doc();
  return fragmentToMarkdown(prosemirrorToYXmlFragment(editorSchema.topNodeType.create(null, block), tmp.getXmlFragment(FRAGMENT)), numbers);
}

// Nodes the markdown parser can't rebuild: re-parsing drops them (or, for
// toggle/callout, their summary/variant).
const LOSSY_NODES = new Set(['noteLink', 'image', 'toggle', 'callout', 'linkPreview']);

const hasLossyNode = (block: PMNode) => {
  let found = LOSSY_NODES.has(block.type.name);
  block.descendants((n) => {
    if (LOSSY_NODES.has(n.type.name)) found = true;
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
  const footnotes = footnoteOrder(current);
  const numbers = new Map(footnotes.map((id, i) => [id, i + 1]));
  const mds = blocks.map((b) => blockToMarkdown(b, numbers));
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
    throw new Error('replace_in_note: the matched text is in a block with a note link, image, toggle, callout or link preview; edit a different span');
  }

  const rangeMd = joined.slice(rangeStart, rangeEnd);
  const replaced = rangeMd.slice(0, at - rangeStart) + newText + rangeMd.slice(end - rangeStart);
  const next: PMNode[] = [...blocks.slice(0, from)];
  parseMarkdown(replaced, footnotes).forEach((n) => next.push(n));
  next.push(...blocks.slice(to + 1));
  write(doc, current.copy(Fragment.fromArray(next)));
}

/** Index of `block` in `text` at or after `from`, as a whole blank-line-separated block; -1 if absent. */
function findBlock(text: string, block: string, from: number): number {
  for (let at = text.indexOf(block, from); at >= 0; at = text.indexOf(block, at + 1)) {
    const end = at + block.length;
    if ((at === 0 || text.endsWith('\n\n', at)) && (end === text.length || text.startsWith('\n\n', end))) return at;
  }
  return -1;
}

/**
 * Replaces the whole body with `markdown`. Every existing block whose markdown (as
 * `toMarkdown` returns it) appears unchanged, in order, keeps its original node read from
 * Yjs, so note links and images in kept blocks survive; only the rest is parsed from markdown.
 */
export function setMarkdown(doc: Y.Doc, markdown: string): void {
  const current = read(doc);
  const footnotes = footnoteOrder(current);
  const numbers = new Map(footnotes.map((id, i) => [id, i + 1]));
  const nonce = getNewId();
  const kept = new Map<string, PMNode>();
  let text = markdown;
  let from = 0;
  current.forEach((block, _offset, i) => {
    const blockMd = blockToMarkdown(block, numbers);
    const at = blockMd ? findBlock(text, blockMd, from) : -1;
    if (at < 0) return;
    // Swap the block for a placeholder paragraph, then swap its original node back in after parsing.
    const token = `jrnlkeep${i}x${nonce}`;
    text = text.slice(0, at) + token + text.slice(at + blockMd.length);
    from = at + token.length;
    kept.set(token, block);
  });

  const next: PMNode[] = [];
  let reused = 0;
  parseMarkdown(text, footnotes).forEach((n) => {
    const original = n.type.name === 'paragraph' ? kept.get(n.textContent) : undefined;
    if (original) reused++;
    next.push(original ?? n);
  });
  // A placeholder that didn't come back as its own paragraph (say, inside a code fence) would
  // leak into the note: then parse the markdown as given, without reuse.
  write(doc, reused === kept.size ? current.copy(Fragment.fromArray(next)) : parseMarkdown(markdown, footnotes));
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
