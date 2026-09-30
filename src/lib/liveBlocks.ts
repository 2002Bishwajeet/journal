/** Code-block languages that render a live preview in the editor. */
export type LiveBlockKind = 'mermaid' | 'svg' | 'html';

/** The live-preview kind for a code block's language, or null for an ordinary code block. */
export function liveBlockKind(language: string | null): LiveBlockKind | null {
  const lang = language?.trim().toLowerCase();
  return lang === 'mermaid' || lang === 'svg' || lang === 'html' ? lang : null;
}

/** SVG source as an `<img>`-safe data URI. Loaded as an image, scripts never run. */
export function svgDataUri(source: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
}

// Inline script and style only: no network, no external subresources, no form posts.
const HTML_BLOCK_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'";

// The one thing a frame tells the app: how tall its document is, whenever that changes (#412).
// It reads nothing else and listens to nothing; the app never sends anything into a frame.
const HEIGHT_REPORT_SCRIPT =
  "<script>new ResizeObserver(() => parent.postMessage({ journalLiveBlock: 1, height: Math.ceil(document.documentElement.getBoundingClientRect().height) }, '*')).observe(document.documentElement)</script>";

/**
 * The document for an `html` block's sandboxed frame. The CSP meta comes first,
 * so it is in force before anything in the (untrusted) source is parsed; the
 * height report comes last, after the source.
 */
export function buildSrcdoc(source: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${HTML_BLOCK_CSP}">${source}${HEIGHT_REPORT_SCRIPT}`;
}

const MIN_FRAME_HEIGHT = 120;
const MAX_FRAME_HEIGHT = 1600;

/**
 * The height to give an `html` block, from a `message` event: the height its
 * own frame reported, clamped (taller content scrolls inside the frame). Null
 * for anything else. `frame` is the block's `iframe.contentWindow`. The frame's
 * source is untrusted and can post any message it likes, so the most a block
 * can do with one is pick its own height within the clamp.
 */
export function frameHeightFromMessage(event: Pick<MessageEvent<unknown>, 'source' | 'data'>, frame: Window | null): number | null {
  if (!frame || event.source !== frame) return null;
  const data = event.data as { journalLiveBlock?: unknown; height?: unknown } | null | undefined;
  if (data?.journalLiveBlock !== 1 || typeof data.height !== 'number' || !Number.isFinite(data.height)) return null;
  return Math.min(Math.max(data.height, MIN_FRAME_HEIGHT), MAX_FRAME_HEIGHT);
}
