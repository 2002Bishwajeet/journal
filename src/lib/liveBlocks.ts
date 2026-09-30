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

/**
 * The document for an `html` block's sandboxed frame. The CSP meta comes first,
 * so it is in force before anything in the (untrusted) source is parsed.
 */
export function buildSrcdoc(source: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${HTML_BLOCK_CSP}">${source}`;
}
