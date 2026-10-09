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

/** Image srcs in parsed markdown that are neither remote nor already attached: files and data: URIs. */
const isLocalImageSrc = (src: string) => !/^(https?|attachment|blob):/i.test(src);

/**
 * The markdown parser returns an image that is alone on its line as a block of its own,
 * which the schema doesn't allow (image is inline) and the serializer drops: put it in a paragraph.
 */
function wrapBlockImages(node: JSONContent) {
  if (!node.content) return;
  const holdsInline = !!node.type && editorSchema.nodes[node.type]?.inlineContent;
  node.content = node.content.map((child) =>
    child.type === 'image' && !holdsInline ? { type: 'paragraph', content: [child] } : child
  );
  node.content.forEach(wrapBlockImages);
}

/** A list item opens with a paragraph, so a link preview line there stays a plain link (#561). */
function unwrapListItemCards(node: JSONContent) {
  if (!node.content) return;
  const [first] = node.content;
  if ((node.type === 'listItem' || node.type === 'taskItem') && first?.type === 'linkPreview') {
    const href = String(first.attrs?.url);
    node.content[0] = { type: 'paragraph', content: [{ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }] };
  }
  node.content.forEach(unwrapListItemCards);
}

function parseJson(markdown: string): JSONContent {
  const json = md.parse(markdown);
  wrapBlockImages(json);
  unwrapListItemCards(json);
  return json;
}

function walkImages(node: JSONContent, visit: (image: JSONContent) => void) {
  if (node.type === 'image') visit(node);
  node.content?.forEach((child) => walkImages(child, visit));
}

/** The distinct local file paths and `data:` URIs of the images in `markdown`, in order. */
export function localImageSources(markdown: string): string[] {
  const found = new Set<string>();
  walkImages(parseJson(markdown), (image) => {
    const src = image.attrs?.src;
    if (typeof src === 'string' && src && isLocalImageSrc(src)) found.add(src);
  });
  return [...found];
}

function swapImageSrcs(json: JSONContent, imageSrcs: ReadonlyMap<string, string>) {
  walkImages(json, (image) => {
    const next = imageSrcs.get(String(image.attrs?.src));
    if (next) image.attrs = { ...image.attrs, src: next };
  });
}

/** A note the agent can see, so a note link can point at it (#561). */
export interface LinkTarget {
  id: string;
  title: string;
}

type CanSee = (noteId: string) => boolean;

function canSeeOf(targets?: readonly LinkTarget[]): CanSee | undefined {
  if (!targets) return undefined;
  const ids = new Set(targets.map((t) => t.id));
  return (noteId) => ids.has(noteId);
}

function noteTitled(targets: readonly LinkTarget[], title: string): LinkTarget {
  const key = title.toLowerCase();
  const matches = targets.filter((t) => t.title.trim().toLowerCase() === key);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`Note link [[${title}]]: no note you can see has this title`);
  throw new Error(`Note link [[${title}]]: ${matches.length} notes have this title; link one by id: [${title}](journal:note/<id>)`);
}

/**
 * Note links in parsed markdown, against the notes in `targets`: `[[Title]]` (noteId null)
 * becomes a link to the one note with that title, and a link to a note not in `targets` is
 * only its label. Without `targets` (markdown import) links are kept and `[[Title]]` stays text.
 */
function resolveNoteLinks(node: JSONContent, targets?: readonly LinkTarget[], canSee = canSeeOf(targets)): void {
  if (!node.content) return;
  node.content = node.content.flatMap((child): JSONContent[] => {
    if (child.type !== 'noteLink') {
      resolveNoteLinks(child, targets, canSee);
      return [child];
    }
    const label = String(child.attrs?.label ?? '');
    const asText = (text: string): JSONContent[] => (text ? [{ type: 'text', text, marks: child.marks }] : []);
    const noteId = child.attrs?.noteId;
    if (noteId) return !canSee || canSee(String(noteId)) ? [child] : asText(label);
    if (!targets) return asText(`[[${label}]]`);
    const target = noteTitled(targets, label);
    return [{ ...child, attrs: { noteId: target.id, label: target.title } }];
  });
}

/**
 * Markdown -> ProseMirror. `imageSrcs` swaps image srcs (a local path for its uploaded
 * `attachment://…`) before the nodes are built. A `[^n]` the note already has is that footnote
 * (`existing[n - 1]`); any other label gets a new id. With `newDefinitions`
 * (appended text), a label the markdown defines is always a new footnote. Note links
 * are resolved against `targets` (`resolveNoteLinks`).
 */
function parseMarkdown(
  markdown: string,
  existing: string[] = [],
  newDefinitions = false,
  imageSrcs?: ReadonlyMap<string, string>,
  targets?: readonly LinkTarget[]
): PMNode {
  const json = parseJson(markdown);
  if (imageSrcs?.size) swapImageSrcs(json, imageSrcs);
  resolveNoteLinks(json, targets);
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

/** With `targets`, a link to a note not in it is only its label. */
export function toMarkdown(doc: Y.Doc, targets?: readonly LinkTarget[]): string {
  return fragmentToMarkdown(doc.getXmlFragment(FRAGMENT), undefined, canSeeOf(targets));
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

export function appendMarkdown(
  doc: Y.Doc,
  markdown: string,
  imageSrcs?: ReadonlyMap<string, string>,
  targets?: readonly LinkTarget[]
): void {
  const current = read(doc);
  const added = parseMarkdown(markdown, footnoteOrder(current), true, imageSrcs, targets);
  const first = current.firstChild;
  const isEmpty = current.childCount === 1 && first?.type.name === 'paragraph' && first.content.size === 0;
  write(doc, isEmpty ? current.copy(added.content) : current.copy(current.content.append(added.content)));
}

/** Markdown of one top-level block, via the same serializer as `toMarkdown`, with the note's footnote `numbers`. */
function blockToMarkdown(block: PMNode, numbers: Map<string, number>, canSee?: CanSee): string {
  const tmp = new Y.Doc();
  return fragmentToMarkdown(
    prosemirrorToYXmlFragment(editorSchema.topNodeType.create(null, block), tmp.getXmlFragment(FRAGMENT)),
    numbers,
    canSee
  );
}

// Nodes the markdown parser can't rebuild: re-parsing drops them (or, for
// toggle/callout, their summary/variant).
const LOSSY_NODES = new Set(['image', 'toggle', 'callout']);

// A link to a note the agent can't see is only its label in the markdown, so re-parsing drops it too.
const isLossy = (n: PMNode, canSee?: CanSee) =>
  LOSSY_NODES.has(n.type.name) || (n.type.name === 'noteLink' && !!n.attrs.noteId && canSee?.(n.attrs.noteId) === false);

const hasLossyNode = (block: PMNode, canSee?: CanSee) => {
  let found = isLossy(block, canSee);
  block.descendants((n) => {
    if (isLossy(n, canSee)) found = true;
    return !found;
  });
  return found;
};

/**
 * `str_replace` over the markdown of the top-level blocks. Only the contiguous
 * blocks the single match spans are re-parsed from markdown; every other block
 * stays the original ProseMirror node read from Yjs.
 */
export function replaceInNote(
  doc: Y.Doc,
  oldText: string,
  newText: string,
  imageSrcs?: ReadonlyMap<string, string>,
  targets?: readonly LinkTarget[]
): void {
  const current = read(doc);
  const blocks: PMNode[] = [];
  current.forEach((b) => blocks.push(b));
  const footnotes = footnoteOrder(current);
  const numbers = new Map(footnotes.map((id, i) => [id, i + 1]));
  const canSee = canSeeOf(targets);
  const mds = blocks.map((b) => blockToMarkdown(b, numbers, canSee));
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

  if (blocks.slice(from, to + 1).some((b) => hasLossyNode(b, canSee))) {
    throw new Error(
      "replace_in_note: the matched text is in a block with an image, toggle, callout or a link to a note you can't see; edit a different span"
    );
  }

  const rangeMd = joined.slice(rangeStart, rangeEnd);
  const replaced = rangeMd.slice(0, at - rangeStart) + newText + rangeMd.slice(end - rangeStart);
  const next: PMNode[] = [...blocks.slice(0, from)];
  parseMarkdown(replaced, footnotes, false, imageSrcs, targets).forEach((n) => next.push(n));
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
export function setMarkdown(
  doc: Y.Doc,
  markdown: string,
  imageSrcs?: ReadonlyMap<string, string>,
  targets?: readonly LinkTarget[]
): void {
  const current = read(doc);
  const footnotes = footnoteOrder(current);
  const numbers = new Map(footnotes.map((id, i) => [id, i + 1]));
  const canSee = canSeeOf(targets);
  const nonce = getNewId();
  const kept = new Map<string, PMNode>();
  let text = markdown;
  let from = 0;
  current.forEach((block, _offset, i) => {
    const blockMd = blockToMarkdown(block, numbers, canSee);
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
  parseMarkdown(text, footnotes, false, imageSrcs, targets).forEach((n) => {
    const original = n.type.name === 'paragraph' ? kept.get(n.textContent) : undefined;
    if (original) reused++;
    next.push(original ?? n);
  });
  // A placeholder that didn't come back as its own paragraph (say, inside a code fence) would
  // leak into the note: then parse the markdown as given, without reuse.
  write(
    doc,
    reused === kept.size ? current.copy(Fragment.fromArray(next)) : parseMarkdown(markdown, footnotes, false, imageSrcs, targets)
  );
}

/**
 * A fresh doc built from markdown. LOSSY for image layout, so
 * only for new notes, never for rewriting existing ones.
 */
export function createDoc(markdown: string, targets?: readonly LinkTarget[]): Y.Doc {
  const doc = new Y.Doc();
  write(doc, parseMarkdown(markdown, [], false, undefined, targets));
  return doc;
}
