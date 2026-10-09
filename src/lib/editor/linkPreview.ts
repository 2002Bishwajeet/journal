/**
 * Link preview card (#173) — pure helpers shared by the editor node, the fetch
 * hook and the Markdown/plain-text serializers.
 *
 * Preview data lives as attributes on the `linkPreview` node, so it travels in
 * the Yjs doc (encrypted with a private note, plain with a public one). The
 * image is stored as a small `data:` URI: `COEP: require-corp` would block a
 * hot-linked remote image, and a remote URL would leak reads to third parties.
 */
import type { LinkPreview } from '@homebase-id/js-lib/media';
import { base64ToUint8Array } from '@/lib/utils';

export interface LinkPreviewAttrs {
  url: string;
  title: string;
  description: string;
  image: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

/** True only for a single http(s) URL token (whitespace around it is ignored). */
export function isPreviewableUrl(text: string): boolean {
  const token = text.trim();
  if (!token || /\s/.test(token)) return false;
  try {
    const { protocol } = new URL(token);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Decodes a base64 `data:image/…` URI; anything else (e.g. a remote URL) → null. */
export function dataUriToBlob(uri: string): Blob | null {
  const comma = uri.indexOf(',');
  if (comma < 0) return null;
  const mime = /^data:(image\/[\w.+-]+);base64$/i.exec(uri.slice(0, comma))?.[1];
  if (!mime) return null;
  try {
    return new Blob([new Uint8Array(base64ToUint8Array(uri.slice(comma + 1)))], { type: mime });
  } catch {
    return null;
  }
}

export function toPreviewAttrs(p: LinkPreview, image: string | null): LinkPreviewAttrs {
  return {
    url: p.url,
    title: p.title ?? '',
    description: p.description ?? '',
    image,
    imageWidth: p.imageWidth ?? null,
    imageHeight: p.imageHeight ?? null,
  };
}

// `[`/`]`/`\` would break the link text; `<` would let page metadata through
// as raw HTML on the share page (it renders with rehype-raw).
const escapeMd = (s: string) => s.replace(/[\\[\]]/g, '\\$&').replace(/</g, '&lt;');

// A newline in page metadata would split the link or quote and let it add its
// own block (a heading, a quote) to the Markdown.
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Ends a Markdown line that is a link preview card (#561). An HTML comment, so the share
 * page and other Markdown viewers show the line as a plain link.
 */
export const PREVIEW_MARKER = '<!-- preview -->';

/**
 * `[title](url)<!-- preview -->`, or `<url><!-- preview -->` while the card has no title.
 * One line, so the card stays one block: the description and image are never included.
 */
export function previewToMarkdown(attrs: Pick<LinkPreviewAttrs, 'url' | 'title'>): string {
  const title = oneLine(attrs.title);
  return (title ? `[${escapeMd(title)}](${attrs.url})` : `<${attrs.url}>`) + PREVIEW_MARKER;
}
