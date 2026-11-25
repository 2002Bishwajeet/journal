import inter from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?inline';
import playfair from '@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2?inline';
import { FONT_PATHS } from './pages';

// The pages' fonts (#1516), inlined into the bundle and served from it: a sign-in page loads nothing from a
// third party. Apart from pages.ts, which an e2e spec imports and which can't import a woff2 itself.

const bytes = (dataUrl: string) => new Uint8Array(Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
const FONTS = new Map([
    [FONT_PATHS.inter, bytes(inter)],
    [FONT_PATHS.playfair, bytes(playfair)],
]);

/** The font at exactly `pathname`, cached for a year; null for any other path. */
export function serveFont(pathname: string): Response | null {
    const font = FONTS.get(pathname);
    if (!font) return null;
    return new Response(font, { headers: { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } });
}
