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
import { parseCodeInfo } from '@/lib/liveBlocks';
import { CALLOUT_VARIANTS, type CalloutVariant } from '@/components/editor/nodes/calloutVariants';

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

/** Markdown of one top-level block (or a cell's blocks), via the same serializer as `toMarkdown`, with the note's footnote `numbers`. */
function blockToMarkdown(block: PMNode | Fragment, numbers: Map<string, number>, canSee?: CanSee): string {
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
const isUnseenNoteLink = (n: PMNode, canSee?: CanSee) =>
  n.type.name === 'noteLink' && !!n.attrs.noteId && canSee?.(n.attrs.noteId) === false;
const isLossy = (n: PMNode, canSee?: CanSee) => LOSSY_NODES.has(n.type.name) || isUnseenNoteLink(n, canSee);

const hasUnseenNoteLink = (node: PMNode, canSee?: CanSee) => {
  let found = false;
  node.descendants((n) => {
    if (isUnseenNoteLink(n, canSee)) found = true;
    return !found;
  });
  return found;
};

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

// ---------------------------------------------------------------------------
// Block-level editing (#560). A top-level block's id is the Yjs item id (`client:clock`)
// of its Y.XmlElement: stable while the block exists, on every device, since sync only
// ever merges updates. Each op writes Yjs directly at the block (or row, column, cell)
// it addresses, so no other block's items are touched.
// ---------------------------------------------------------------------------

const BLOCK_NOT_FOUND = 'block not found; call get_note with format blocks';

export interface BlockAttrs {
  variant?: CalloutVariant;
  summary?: string;
  level?: number;
  language?: string | null;
  id?: string | null;
  wide?: boolean;
  checked?: boolean[];
}

export interface NoteBlock {
  id: string;
  type: string;
  markdown: string;
  /** The block's editable attributes (see `SETTABLE_ATTRS`); empty for most blocks. */
  attrs: BlockAttrs;
  /** A table's cells, as markdown. */
  rows?: string[][];
}

export type BlockOp =
  | { type: 'replace' | 'insert_after' | 'insert_before' | 'set_text'; markdown: string }
  | { type: 'delete' }
  | { type: 'set_attrs'; attrs: BlockAttrs }
  | { type: 'set_cell'; row: number; col: number; markdown: string }
  | { type: 'insert_row'; at: number; cells?: string[] }
  | { type: 'delete_row' | 'insert_column' | 'delete_column'; at: number };

/** The attributes `set_attrs` can change, by block type. */
const SETTABLE_ATTRS: Record<string, (keyof BlockAttrs)[]> = {
  callout: ['variant'],
  toggle: ['summary'],
  heading: ['level'],
  codeBlock: ['language', 'id', 'wide'],
  taskList: ['checked'],
};

const LIVE_BLOCK_ID = /^[a-z0-9]{4,12}$/;

const blockIdOf = (el: Y.XmlElement) => `${el._item!.id.client}:${el._item!.id.clock}`;

const freshMeta = () => ({ mapping: new Map(), isOMark: new Map() });

function blockAttrs(node: PMNode): BlockAttrs {
  switch (node.type.name) {
    case 'callout':
      return { variant: node.attrs.variant };
    case 'toggle':
      return { summary: node.attrs.summary };
    case 'heading':
      return { level: node.attrs.level };
    case 'codeBlock':
      return parseCodeInfo(node.attrs.language);
    case 'taskList': {
      const checked: boolean[] = [];
      node.forEach((item) => checked.push(!!item.attrs.checked));
      return { checked };
    }
    default:
      return {};
  }
}

/** The note as ProseMirror, with the top-level Yjs element of each block. */
function readBlocks(doc: Y.Doc): { root: PMNode; elements: Y.XmlElement[] } {
  const root = read(doc);
  const elements = doc.getXmlFragment(FRAGMENT).toArray().filter((t): t is Y.XmlElement => t instanceof Y.XmlElement);
  if (elements.length !== root.childCount) throw new Error('This note has content the editor cannot read; edit it in Journal');
  return { root, elements };
}

/** The note's top-level blocks, each with its id for `editBlock`. With `targets`, a link to a note not in it is only its label. */
export function noteBlocks(doc: Y.Doc, targets?: readonly LinkTarget[]): NoteBlock[] {
  const { root, elements } = readBlocks(doc);
  const numbers = new Map(footnoteOrder(root).map((id, i) => [id, i + 1]));
  const canSee = canSeeOf(targets);
  return elements.map((el, i) => {
    const node = root.child(i);
    const block: NoteBlock = { id: blockIdOf(el), type: node.type.name, markdown: blockToMarkdown(node, numbers, canSee), attrs: blockAttrs(node) };
    if (node.type.name === 'table') {
      const rows: string[][] = [];
      node.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(blockToMarkdown(cell.content, numbers, canSee)));
        rows.push(cells);
      });
      block.rows = rows;
    }
    return block;
  });
}

/** Inserts `nodes` as new Yjs elements at `index` of `parent`; returns the elements. */
function insertNodes(doc: Y.Doc, parent: Y.XmlFragment, index: number, nodes: PMNode[]): Y.XmlElement[] {
  if (!nodes.length) return [];
  const els = nodes.map((node) => new Y.XmlElement(node.type.name));
  parent.insert(index, els);
  els.forEach((el, i) => updateYFragment(doc, el, nodes[i], freshMeta()));
  return els;
}

function checkIndex(at: number, max: number, what: string): void {
  if (!Number.isInteger(at) || at < 0 || at > max) throw new Error(`edit_block: ${what} ${at} is out of range 0–${max}`);
}

/** A block element, typed for the non-string attributes y-prosemirror stores (level, checked). */
type AttrsElement = Y.XmlElement<{ [key: string]: string | number | boolean }>;

function setAttrs(el: AttrsElement, node: PMNode, attrs: BlockAttrs): void {
  const name = node.type.name;
  const allowed = SETTABLE_ATTRS[name] ?? [];
  const keys = (Object.keys(attrs) as (keyof BlockAttrs)[]).filter((key) => attrs[key] !== undefined);
  if (!keys.length) throw new Error('edit_block: set_attrs needs at least one attribute');
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length) {
    const takes = allowed.length ? `; it takes ${allowed.join(', ')}` : '';
    throw new Error(`edit_block: a ${name} block has no settable ${unknown.join(', ')}${takes}`);
  }
  const { variant, summary, level, checked } = attrs;
  if (variant !== undefined) {
    if (!CALLOUT_VARIANTS.includes(variant)) throw new Error(`edit_block: variant must be one of ${CALLOUT_VARIANTS.join(', ')}`);
    el.setAttribute('variant', variant);
  }
  if (summary !== undefined) el.setAttribute('summary', summary);
  if (level !== undefined) {
    if (!Number.isInteger(level) || level < 1 || level > 6) throw new Error('edit_block: level must be 1 to 6');
    el.setAttribute('level', level);
  }
  if (name === 'codeBlock') {
    // The language attribute is the fence's info string (```react wide id=k3f9).
    const info = { ...parseCodeInfo(node.attrs.language), ...attrs };
    if (info.id && !LIVE_BLOCK_ID.test(info.id)) throw new Error('edit_block: id must be 4 to 12 of a-z and 0-9');
    if (info.language && /\s/.test(info.language)) throw new Error('edit_block: language must be one word');
    if (!info.language && (info.id || info.wide)) throw new Error('edit_block: id and wide need a language');
    el.setAttribute('language', [info.language, info.wide && 'wide', info.id && `id=${info.id}`].filter(Boolean).join(' '));
  }
  if (checked !== undefined) {
    const items = el.toArray().filter((t) => t instanceof Y.XmlElement) as AttrsElement[];
    if (checked.length !== items.length) throw new Error(`edit_block: checked needs one value per task (${items.length})`);
    items.forEach((item, i) => {
      if (!!node.child(i).attrs.checked !== checked[i]) item.setAttribute('checked', checked[i]);
    });
  }
}

type TableOp = Extract<BlockOp, { type: 'set_cell' | 'insert_row' | 'delete_row' | 'insert_column' | 'delete_column' }>;

function editTable(doc: Y.Doc, table: Y.XmlElement, node: PMNode, op: TableOp, parse: (markdown: string) => PMNode[]): void {
  if (node.type.name !== 'table') throw new Error(`edit_block: ${op.type} works on a table; this block is a ${node.type.name}`);
  const rows = table.toArray() as Y.XmlElement[];
  const cellNode = (type: PMNode['type'], attrs: PMNode['attrs'] | null, markdown: string) => {
    const cell = type.createAndFill(attrs, parse(markdown));
    if (!cell) throw new Error('edit_block: that markdown cannot go in a table cell');
    return cell;
  };

  if (op.type === 'set_cell') {
    checkIndex(op.row, node.childCount - 1, 'row');
    const row = node.child(op.row);
    checkIndex(op.col, row.childCount - 1, 'col');
    const cell = row.child(op.col);
    const cellEl = rows[op.row].get(op.col) as Y.XmlElement;
    updateYFragment(doc, cellEl, cellNode(cell.type, cell.attrs, op.markdown), freshMeta());
    return;
  }

  let merged = false;
  node.forEach((row) => row.forEach((cell) => {
    if (cell.attrs.colspan > 1 || cell.attrs.rowspan > 1) merged = true;
  }));
  if (merged) throw new Error(`edit_block: ${op.type} can't edit a table with merged cells; use replace`);
  const width = node.child(0).childCount;
  const { tableCell, tableRow } = editorSchema.nodes;

  switch (op.type) {
    case 'insert_row': {
      checkIndex(op.at, node.childCount, 'row');
      const cells = op.cells ?? [];
      if (cells.length > width) throw new Error(`edit_block: the table has ${width} columns`);
      // The column widths of the row it goes next to.
      const near = node.child(Math.min(op.at, node.childCount - 1));
      const row = Array.from({ length: width }, (_, i) => cellNode(tableCell, { colwidth: near.child(i).attrs.colwidth }, cells[i] ?? ''));
      insertNodes(doc, table, op.at, [tableRow.create(null, row)]);
      return;
    }
    case 'delete_row':
      checkIndex(op.at, node.childCount - 1, 'row');
      if (node.childCount === 1) throw new Error('edit_block: that is the only row; delete the block instead');
      table.delete(op.at, 1);
      return;
    case 'insert_column':
      checkIndex(op.at, width, 'column');
      // Each row gets the cell type of its neighbour, so a header row gets a header cell.
      node.forEach((row, _, r) => {
        insertNodes(doc, rows[r], op.at, [row.child(Math.min(op.at, width - 1)).type.createAndFill()!]);
      });
      return;
    case 'delete_column':
      checkIndex(op.at, width - 1, 'column');
      if (width === 1) throw new Error('edit_block: that is the only column; delete the block instead');
      rows.forEach((row) => row.delete(op.at, 1));
      return;
  }
}

/**
 * Applies `op` to the block with id `blockId`, as Yjs changes at that block only. Returns
 * the ids of the blocks the op leaves in its place: the block itself, the blocks `replace`
 * or an insert creates, or none for `delete`.
 */
export function editBlock(
  doc: Y.Doc,
  blockId: string,
  op: BlockOp,
  imageSrcs?: ReadonlyMap<string, string>,
  targets?: readonly LinkTarget[]
): string[] {
  const { root, elements } = readBlocks(doc);
  const index = elements.findIndex((el) => blockIdOf(el) === blockId);
  if (index < 0) throw new Error(`edit_block: ${BLOCK_NOT_FOUND}`);
  const el = elements[index];
  const node = root.child(index);
  const fragment = doc.getXmlFragment(FRAGMENT);
  const footnotes = footnoteOrder(root);
  const parse = (markdown: string) => {
    const nodes: PMNode[] = [];
    parseMarkdown(markdown, footnotes, false, imageSrcs, targets).forEach((n) => nodes.push(n));
    return nodes;
  };
  // Rewriting content that holds a link to a note the agent can't see would drop that link,
  // as it reads as its label only (see `replaceInNote`).
  const canSee = canSeeOf(targets);
  const rewritten = op.type === 'replace' || op.type === 'set_text' ? node : op.type === 'set_cell' ? node.maybeChild(op.row)?.maybeChild(op.col) : null;
  if (rewritten && hasUnseenNoteLink(rewritten, canSee)) {
    throw new Error(`edit_block: this ${op.type === 'set_cell' ? 'cell' : 'block'} holds a link to a note you can't see; edit a different block`);
  }
  const insert = (at: number, nodes: PMNode[]) => insertNodes(doc, fragment, at, nodes).map(blockIdOf);

  let ids = [blockId];
  doc.transact(() => {
    switch (op.type) {
      case 'delete':
        fragment.delete(index, 1);
        ids = [];
        break;
      case 'insert_before':
        ids = insert(index, parse(op.markdown));
        break;
      case 'insert_after':
        ids = insert(index + 1, parse(op.markdown));
        break;
      case 'replace': {
        const nodes = parse(op.markdown);
        // Same type: update the block in place, so it keeps its id; otherwise swap it out.
        if (nodes[0]?.type === node.type) {
          updateYFragment(doc, el, nodes[0], freshMeta());
          ids = [blockId, ...insert(index + 1, nodes.slice(1))];
        } else {
          fragment.delete(index, 1);
          ids = insert(index, nodes);
        }
        break;
      }
      case 'set_text': {
        if (node.type.name !== 'callout' && node.type.name !== 'toggle') {
          throw new Error(`edit_block: set_text works on a callout or toggle; this block is a ${node.type.name}, use replace`);
        }
        const next = node.type.createAndFill(node.attrs, parse(op.markdown));
        if (!next) throw new Error(`edit_block: that markdown cannot go in a ${node.type.name}`);
        updateYFragment(doc, el, next, freshMeta());
        break;
      }
      case 'set_attrs':
        setAttrs(el as AttrsElement, node, op.attrs);
        break;
      default:
        editTable(doc, el, node, op, parse);
    }
    // A note always holds at least one block.
    if (fragment.length === 0) insert(0, [editorSchema.nodes.paragraph.create()]);
  }, 'agent');

  // Keep the footnotes section in step, as `write` does; most edits leave it unchanged.
  const tr = new Transform(read(doc));
  if (normalizeFootnotes(tr)) write(doc, tr.doc);
  return ids;
}
