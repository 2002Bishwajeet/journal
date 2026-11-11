/**
 * Temporary copy of odin-js#1033, replace with the js-lib export once released.
 *
 * Only the Tiptap -> Slate half Journal needs to publish an article: `tiptapToSlate`,
 * `cleanTiptapDoc`, `slateHash` and `toStoredArticleBody` from
 * `packages/libs/js-lib/src/public/posts/ArticleBody/{SlateTiptap,StoredArticleBody}.ts`,
 * with the same names, signatures and output. Once `@homebase-id/js-lib/public` exports
 * them, import them from there and delete this file.
 */

/**
 * A Tiptap (ProseMirror) JSON node, as `editor.getJSON()` writes it. The same shape as
 * `JSONContent` from `@tiptap/core`, written out so js-lib needs no Tiptap dependency.
 */
export interface TiptapJSONContent {
  type?: string;
  /* eslint-disable @typescript-eslint/no-explicit-any -- as in odin-js#1033, so the swap to the js-lib export is an import change only */
  attrs?: Record<string, any>;
  content?: TiptapJSONContent[];
  marks?: { type: string; attrs?: Record<string, any>; [key: string]: any }[];
  text?: string;
  [key: string]: any;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export type SlateNode = Record<string, unknown> & { type?: string; text?: string; children?: SlateNode[] };

const TIPTAP_MARKS: Record<string, string> = { bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikethrough', code: 'code', kbd: 'kbd' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasOwn = (map: object, key: unknown): key is string => typeof key === 'string' && Object.hasOwn(map, key);
const stringOr = <T>(v: unknown, fallback: T): string | T => (typeof v === 'string' ? v : fallback);
/** A text field as a string: numbers and booleans are kept as their text, anything else is empty. */
const textField = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';

// ---- Tiptap JSON, cleaned ----

export type CleanTiptapOptions = {
  /** Node types to keep; any other node is replaced by its content. Default: every string type. */
  isKnownNode?: (type: string) => boolean;
  /** Mark types to keep; any other mark is dropped. Default: every string type. */
  isKnownMark?: (type: string) => boolean;
};

/**
 * A well-formed copy of a Tiptap document: only plain objects with a string type, `content` and
 * `marks` only when they are arrays, `attrs` only when it is an object, and `text` as a string.
 * A node of an unknown type is replaced by its (cleaned) content, so its text stays. The result is
 * always a `doc`; a root that isn't one becomes its only child.
 */
export function cleanTiptapDoc(doc: unknown, options: CleanTiptapOptions = {}): TiptapJSONContent {
  const knownNode = options.isKnownNode ?? (() => true);
  const knownMark = options.isKnownMark ?? (() => true);

  const marksOf = (marks: unknown[]) =>
    marks.flatMap((m) =>
      isObject(m) && typeof m.type === 'string' && knownMark(m.type)
        ? [{ type: m.type, ...(isObject(m.attrs) ? { attrs: m.attrs } : {}) }]
        : []
    );
  const nodes = (list: unknown): TiptapJSONContent[] => (Array.isArray(list) ? list.flatMap(node) : []);
  const node = (n: unknown): TiptapJSONContent[] => {
    if (!isObject(n) || typeof n.type !== 'string') return [];
    if (!knownNode(n.type)) return nodes(n.content);
    const out: TiptapJSONContent = { type: n.type };
    if (isObject(n.attrs)) out.attrs = n.attrs;
    if ('text' in n) out.text = textField(n.text);
    if (Array.isArray(n.content)) out.content = nodes(n.content);
    if (Array.isArray(n.marks)) {
      const marks = marksOf(n.marks);
      if (marks.length) out.marks = marks;
    }
    return [out];
  };

  if (!isObject(doc)) return { type: 'doc', content: [] };
  if (doc.type === 'doc' || doc.type === undefined) return { type: 'doc', content: nodes(doc.content) };
  return { type: 'doc', content: node(doc) };
}

// ---- Tiptap -> Slate (the reduced copy) ----

const emptyLeaf = (): SlateNode[] => [{ text: '' }];
const nonEmpty = (children: SlateNode[]) => (children.length ? children : emptyLeaf());

function inlineToSlate(n: TiptapJSONContent, ctx: Ctx): SlateNode[] {
  switch (n.type) {
    case 'text': {
      const leaf: SlateNode = { text: n.text ?? '' };
      for (const m of n.marks ?? []) if (hasOwn(TIPTAP_MARKS, m.type)) leaf[TIPTAP_MARKS[m.type]] = true;
      const link = n.marks?.find((m) => m.type === 'link');
      return [link ? { type: 'a', url: stringOr(link.attrs?.href, ''), children: [leaf] } : leaf];
    }
    case 'hardBreak':
      return [{ text: '\n' }];
    case 'mention':
      return [{ type: 'mention', value: stringOr(n.attrs?.id, ''), children: emptyLeaf() }];
    case 'inlineMath':
      return [{ text: textField(n.attrs?.latex), code: true }];
    case 'footnoteReference':
      return [{ text: `[${ctx.footnoteNumber(n.attrs?.id)}]` }];
    case 'image':
      return []; // lifted out of the paragraph by `paragraphToSlate`
    default:
      return (n.content ?? []).flatMap((c) => inlineToSlate(c, ctx));
  }
}

const inlinesToSlate = (content: TiptapJSONContent[] | undefined, ctx: Ctx) => (content ?? []).flatMap((c) => inlineToSlate(c, ctx));

/** Merges adjacent Slate text leaves with the same marks, as Slate does on normalize. */
function mergeLeaves(children: SlateNode[]): SlateNode[] {
  const out: SlateNode[] = [];
  for (const c of children) {
    const prev = out[out.length - 1];
    const sameMarks = (a: SlateNode, b: SlateNode) => {
      const keys = (x: SlateNode) => Object.keys(x).filter((k) => k !== 'text').sort().join();
      return keys(a) === keys(b);
    };
    if (prev && !prev.type && !c.type && typeof prev.text === 'string' && typeof c.text === 'string' && sameMarks(prev, c))
      out[out.length - 1] = { ...prev, text: prev.text + c.text };
    else out.push(c);
  }
  return out;
}

const textBlock = (type: string, content: TiptapJSONContent[] | undefined, ctx: Ctx): SlateNode => ({
  type,
  children: nonEmpty(mergeLeaves(inlinesToSlate(content, ctx))),
});

function imageToSlate(img: TiptapJSONContent): SlateNode[] {
  const attrs = img.attrs ?? {};
  const [fileKey, fileId, src, alt] = [attrs.fileKey, attrs.fileId, attrs.src, attrs.alt].map((v) => stringOr(v, undefined));
  const caption = attrs.caption === null ? null : stringOr(attrs.caption, undefined);
  const out: SlateNode[] = [];
  if (fileKey) out.push({ type: 'local_image', fileKey, ...(fileId ? { fileId } : {}), children: emptyLeaf() });
  else if (src && !src.startsWith('data:')) out.push({ type: 'p', children: [{ type: 'a', url: src, children: [{ text: alt || src }] }] });
  // null caption shows the alt text; "" hides it.
  const shown = caption ?? alt;
  if (shown) out.push({ type: 'p', children: [{ text: shown, italic: true }] });
  return out;
}

/** A paragraph's images become blocks of their own around its text. */
function paragraphToSlate(n: TiptapJSONContent, ctx: Ctx, type = 'p'): SlateNode[] {
  const images = (n.content ?? []).filter((c) => c.type === 'image');
  const rest = (n.content ?? []).filter((c) => c.type !== 'image');
  const out: SlateNode[] = [];
  if (rest.length || !images.length) out.push(textBlock(type, rest, ctx));
  for (const img of images) out.push(...imageToSlate(img));
  return out;
}

/** The text of a container's blocks, one line each, as one inline run. */
function flatInlines(blocks: TiptapJSONContent[] | undefined, ctx: Ctx): SlateNode[] {
  return mergeLeaves(
    blocksToSlate(blocks, ctx).flatMap((b, i) => [...(i ? [{ text: '\n' }] : []), ...flatten(b)]),
  );
}

/** A Slate block's inline content; nested blocks are joined by line breaks. */
function flatten(b: SlateNode): SlateNode[] {
  if (b.type === 'a' || b.type === 'mention' || !b.type) return [b];
  if (b.type === 'local_image') return [];
  return (b.children ?? []).flatMap((c, i) =>
    c.type && !['a', 'mention'].includes(c.type) ? [...(i ? [{ text: '\n' }] : []), ...flatten(c)] : [c],
  );
}

function listToSlate(n: TiptapJSONContent, ctx: Ctx, type: 'ul' | 'ol', prefix?: (item: TiptapJSONContent) => string): SlateNode {
  return {
    type,
    children: (n.content ?? []).map((item) => {
      const [first, ...rest] = item.content ?? [];
      const lic: SlateNode = first?.type === 'paragraph' ? textBlock('lic', first.content, ctx) : { type: 'lic', children: emptyLeaf() };
      if (prefix) lic.children = mergeLeaves([{ text: prefix(item) }, ...(lic.children ?? [])]);
      const nested = (first?.type === 'paragraph' ? rest : item.content ?? []).flatMap((c) =>
        c.type === 'bulletList' || c.type === 'orderedList' || c.type === 'taskList' ? blockToSlate(c, ctx) : [{ type: 'lic', children: nonEmpty(flatInlines([c], ctx)) }],
      );
      return { type: 'li', children: [lic, ...nested] };
    }),
  };
}

function blockToSlate(n: TiptapJSONContent, ctx: Ctx): SlateNode[] {
  switch (n.type) {
    case 'paragraph':
      return paragraphToSlate(n, ctx);
    case 'heading':
      // The old renderer has h1 and h2 only.
      return paragraphToSlate(n, ctx, (n.attrs?.level ?? 1) <= 1 ? 'h1' : 'h2');
    case 'blockquote':
    case 'callout':
      return [{ type: 'blockquote', children: nonEmpty(flatInlines(n.content, ctx)) }];
    case 'codeBlock':
    case 'blockMath': {
      const code = n.type === 'blockMath' ? String(n.attrs?.latex ?? '') : (n.content ?? []).map((c) => c.text ?? '').join('');
      const lang = n.type === 'blockMath' ? 'latex' : n.attrs?.language;
      return [{ type: 'code_block', ...(lang ? { lang } : {}), children: code.split('\n').map((line) => ({ type: 'code_line', children: [{ text: line }] })) }];
    }
    case 'bulletList':
      return [listToSlate(n, ctx, 'ul')];
    case 'orderedList':
      return [listToSlate(n, ctx, 'ol')];
    case 'taskList':
      return [listToSlate(n, ctx, 'ul', (item) => (item.attrs?.checked ? '☑ ' : '☐ '))];
    case 'table':
      // One paragraph per row, cells separated by " | "; header cells bold.
      return (n.content ?? []).map((row) => ({
        type: 'p',
        children: nonEmpty(
          mergeLeaves(
            (row.content ?? []).flatMap((cell, i) => {
              const text = flatInlines(cell.content, ctx).map((l) => (cell.type === 'tableHeader' && !l.type ? { ...l, bold: true } : l));
              return [...(i ? [{ text: ' | ' }] : []), ...text];
            }),
          ),
        ),
      }));
    case 'toggle':
      return [{ type: 'p', children: [{ text: String(n.attrs?.summary ?? ''), bold: true }] }, ...blocksToSlate(n.content, ctx)];
    case 'gallery':
      return (n.content ?? []).flatMap(imageToSlate);
    case 'linkPreview': {
      const url = String(n.attrs?.url ?? '');
      return url ? [{ type: 'p', children: [{ type: 'a', url, children: [{ text: String(n.attrs?.title || url) }] }] }] : [];
    }
    case 'footnotes':
      return [
        { type: 'p', children: [{ text: 'Notes', bold: true }] },
        {
          type: 'ol',
          children: (n.content ?? []).map((fn) => ({ type: 'li', children: [{ type: 'lic', children: nonEmpty(flatInlines(fn.content, ctx)) }] })),
        },
      ];
    case 'horizontalRule':
      return [];
    default:
      // Unknown block: keep its text.
      return n.content?.length ? [{ type: 'p', children: nonEmpty(flatInlines(n.content, ctx)) }] : [];
  }
}

type Ctx = { footnoteNumber: (id: unknown) => number };

const blocksToSlate = (blocks: TiptapJSONContent[] | undefined, ctx: Ctx) => (blocks ?? []).flatMap((b) => blockToSlate(b, ctx));

/** The reduced Slate copy of a Tiptap document, for old clients reading `body`. Never throws. */
export function tiptapToSlate(input: TiptapJSONContent): SlateNode[] {
  const doc = cleanTiptapDoc(input);
  // Footnotes are numbered by their order in the footnotes section.
  const ids = (doc.content ?? []).filter((b) => b.type === 'footnotes').flatMap((s) => (s.content ?? []).map((fn) => fn.attrs?.id));
  const ctx: Ctx = { footnoteNumber: (id) => ids.indexOf(id) + 1 || ids.length + 1 };
  const out = blocksToSlate(doc.content, ctx);
  return out.length ? out : [{ type: 'p', children: emptyLeaf() }];
}


// ---- StoredArticleBody ----

export const BODY_DOC_FORMAT = 'tiptap-v1';

export type StoredBodyDoc = { format: typeof BODY_DOC_FORMAT; doc: TiptapJSONContent; slateHash: string };
export type StoredArticleBody = { body: SlateNode[]; bodyDoc: StoredBodyDoc };

/** Lowercase hex SHA-256 of the UTF-8 bytes of JSON.stringify(body). */
export async function slateHash(body: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The `body` and `bodyDoc` an article stores for a document. */
export async function toStoredArticleBody(doc: TiptapJSONContent): Promise<StoredArticleBody> {
  const body = tiptapToSlate(doc);
  return { body, bodyDoc: { format: BODY_DOC_FORMAT, doc, slateHash: await slateHash(body) } };
}
