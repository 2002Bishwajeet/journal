// The 1200×630 link-card image of a public note (#441, #434): the cover with a scrim,
// the title and the logo, or without a cover a designed paper card. One light
// template, since crawlers have no theme. Loaded with a dynamic import() from the
// publish/save path and the share dialog.

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

/** og:image's 1.91:1. A cover up to this wide fills the card; filling crops at most a sliver of its sides. */
const FILL_MAX_RATIO = 1.91;
const BLUR_PX = 32;

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CardLayout {
    /** Source rect drawn blurred over the whole card, behind a contained cover. */
    background?: Rect;
    /** Source rect of the cover, in image pixels. */
    source: Rect;
    /** Where `source` lands on the card. */
    dest: Rect;
}

/**
 * The part of a `width`×`height` image that `object-fit: cover` shows in the card at
 * `object-position: 50% <positionY>%`, the editor band's crop.
 */
function coverSource(width: number, height: number, positionY: number): Rect {
    const scale = Math.max(CARD_WIDTH / width, CARD_HEIGHT / height);
    const w = CARD_WIDTH / scale;
    const h = CARD_HEIGHT / scale;
    return { x: (width - w) / 2, y: ((height - h) * positionY) / 100, width: w, height: h };
}

/**
 * Where a `width`×`height` cover goes on the card. Up to 1.91:1 it fills the card
 * (cropped vertically at `positionY`, like the editor band). A wider cover is shown
 * whole, centred, over a blurred fill of itself, so no side is cut off.
 */
export function cardLayout(width: number, height: number, positionY: number): CardLayout {
    const full: Rect = { x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT };
    if (width / height <= FILL_MAX_RATIO) {
        return { source: coverSource(width, height, positionY), dest: full };
    }
    const destHeight = (height * CARD_WIDTH) / width;
    return {
        background: coverSource(width, height, positionY),
        source: { x: 0, y: 0, width, height },
        dest: { x: 0, y: (CARD_HEIGHT - destHeight) / 2, width: CARD_WIDTH, height: destHeight },
    };
}

/**
 * Greedy word wrap of `text` into at most `maxLines` lines no wider than `maxWidth`, as
 * measured by `measure`. A word wider than a line is broken between characters. Text
 * that doesn't fit ends the last line with `…`.
 */
export function wrapText(text: string, maxWidth: number, maxLines: number, measure: (s: string) => number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
        for (const piece of measure(word) > maxWidth ? breakWord(word, maxWidth, measure) : [word]) {
            const next = line ? `${line} ${piece}` : piece;
            if (!line || measure(next) <= maxWidth) {
                line = next;
            } else {
                lines.push(line);
                line = piece;
            }
        }
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ellipsize(kept[maxLines - 1], maxWidth, measure);
    return kept;
}

function breakWord(word: string, maxWidth: number, measure: (s: string) => number): string[] {
    const parts: string[] = [];
    let part = '';
    for (const char of word) {
        if (part && measure(part + char) > maxWidth) {
            parts.push(part);
            part = char;
        } else {
            part += char;
        }
    }
    return [...parts, part];
}

function ellipsize(line: string, maxWidth: number, measure: (s: string) => number): string {
    let chars = Array.from(line);
    const all = Array.from(line);
    while (chars.length > 0 && measure(`${chars.join('').trimEnd()}…`) > maxWidth) chars = chars.slice(0, -1);
    let fit = chars.join('').trimEnd();
    // Cut mid-word: back off to the last space, unless the line is one long word.
    const space = fit.lastIndexOf(' ');
    if (chars.length < all.length && !/\s/.test(all[chars.length]) && space > 0) fit = fit.slice(0, space).trimEnd();
    return `${fit}…`;
}

// Journal's light theme (src/index.css) and fonts.
const PAPER = '#FDFCF8';
const INK = '#2C2B29';
const MUTED = '#8A8780';
const RULE = '#E6E4DD';
const SERIF = '"Playfair Display Variable", serif';
const SANS = '"Inter Variable", system-ui, sans-serif';
const TITLE_SIZE = 64;
const TITLE_FONT = `600 ${TITLE_SIZE}px ${SERIF}`;
// A title that fits in two lines is drawn larger.
const TITLE_LARGE_SIZE = 76;
const TITLE_LARGE_FONT = `600 ${TITLE_LARGE_SIZE}px ${SERIF}`;
const TITLE_LARGE_LINE = 90;
const EXCERPT_SIZE = 30;
const EXCERPT_FONT = `400 ${EXCERPT_SIZE}px ${SANS}`;
const AUTHOR_FONT = `500 28px ${SANS}`;
const WORDMARK_FONT = `600 30px ${SERIF}`;

const PAD = 80;
const TEXT_WIDTH = CARD_WIDTH - 2 * PAD;
const TITLE_LINE = 78;
const EXCERPT_LINE = 42;
const LOGO_SIZE = 44;
const LOGO_GAP = 14;

export interface CardText {
    title: string;
    excerpt?: string;
    author: string;
}

export interface CardCover {
    image: Blob;
    positionY: number;
}

type Ctx = OffscreenCanvasRenderingContext2D;

/** `text` wrapped in `font` to the card's text width (`font` stays set for drawing). */
function wrapIn(ctx: Ctx, font: string, text: string, maxLines: number, maxWidth = TEXT_WIDTH): string[] {
    ctx.font = font;
    return wrapText(text, maxWidth, maxLines, (s) => ctx.measureText(s).width);
}

/** The title's lines, at the large size when it fits in two lines, else up to three at the normal size. */
function fitTitle(ctx: Ctx, title: string): { lines: string[]; size: number; lineHeight: number } {
    const large = wrapIn(ctx, TITLE_LARGE_FONT, title, 3);
    if (large.length <= 2) return { lines: large, size: TITLE_LARGE_SIZE, lineHeight: TITLE_LARGE_LINE };
    return { lines: wrapIn(ctx, TITLE_FONT, title, 3), size: TITLE_SIZE, lineHeight: TITLE_LINE };
}

/** Draw `lines` in the current font and fill, the first line box's top at `top`. */
function drawLines(ctx: Ctx, lines: string[], top: number, lineHeight: number, size: number): void {
    ctx.textBaseline = 'top';
    lines.forEach((line, i) => ctx.fillText(line, PAD, top + i * lineHeight + (lineHeight - size) / 2));
}

/** The logo tile and the wordmark, centred on `centerY`, starting at `x` or (right-aligned) ending at it. */
function drawBrand(ctx: Ctx, logo: ImageBitmap | null, x: number, centerY: number, color: string, align: 'left' | 'right', border?: string): void {
    ctx.font = WORDMARK_FONT;
    const logoWidth = logo ? LOGO_SIZE + LOGO_GAP : 0;
    const left = align === 'left' ? x : x - logoWidth - ctx.measureText('Journal').width;
    if (logo) {
        // The tile is the middle of the logo image, without its beige margin.
        const inset = logo.width * 0.17;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(left, centerY - LOGO_SIZE / 2, LOGO_SIZE, LOGO_SIZE, 11);
        ctx.clip();
        ctx.drawImage(logo, inset, inset, logo.width - 2 * inset, logo.height - 2 * inset,
            left, centerY - LOGO_SIZE / 2, LOGO_SIZE, LOGO_SIZE);
        ctx.restore();
        if (border) {
            // On paper the beige tile would blend in.
            ctx.strokeStyle = border;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(left, centerY - LOGO_SIZE / 2, LOGO_SIZE, LOGO_SIZE, 11);
            ctx.stroke();
        }
    }
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText('Journal', left + logoWidth, centerY);
}

function drawPaperCard(ctx: Ctx, text: CardText, logo: ImageBitmap | null): void {
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // The title and excerpt are one block, centred between the top and the footer rule.
    const footerY = CARD_HEIGHT - PAD - 22;
    const ruleY = footerY - 50;
    const title = fitTitle(ctx, text.title);
    const excerpt = text.excerpt ? wrapIn(ctx, EXCERPT_FONT, text.excerpt, 2) : [];
    const titleHeight = title.lines.length * title.lineHeight;
    const blockHeight = titleHeight + (excerpt.length ? 24 + excerpt.length * EXCERPT_LINE : 0);
    const top = Math.max(PAD, (ruleY - blockHeight) / 2);

    ctx.font = title.size === TITLE_SIZE ? TITLE_FONT : TITLE_LARGE_FONT;
    ctx.fillStyle = INK;
    drawLines(ctx, title.lines, top, title.lineHeight, title.size);
    if (excerpt.length) {
        ctx.font = EXCERPT_FONT;
        ctx.fillStyle = MUTED;
        drawLines(ctx, excerpt, top + titleHeight + 24, EXCERPT_LINE, EXCERPT_SIZE);
    }

    // Footer: a rule, then the author on the left and the brand on the right.
    ctx.fillStyle = RULE;
    ctx.fillRect(PAD, ruleY, TEXT_WIDTH, 2);
    drawAuthor(ctx, text.author, footerY, INK);
    drawBrand(ctx, logo, CARD_WIDTH - PAD, footerY, INK, 'right', RULE);
}

/** The author on the left of the footer, cut to half the text width. */
function drawAuthor(ctx: Ctx, name: string, centerY: number, color: string): void {
    const [author = ''] = wrapIn(ctx, AUTHOR_FONT, name, 1, TEXT_WIDTH / 2);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(author, PAD, centerY);
}

function drawCoverCard(ctx: Ctx, bitmap: ImageBitmap, positionY: number, text: CardText, logo: ImageBitmap | null): void {
    const { background, source, dest } = cardLayout(bitmap.width, bitmap.height, positionY);
    if (background) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
        ctx.filter = `blur(${BLUR_PX}px)`;
        // Overdraw by the blur radius so the blur doesn't fade the card's edges.
        ctx.drawImage(bitmap, background.x, background.y, background.width, background.height,
            -BLUR_PX, -BLUR_PX, CARD_WIDTH + 2 * BLUR_PX, CARD_HEIGHT + 2 * BLUR_PX);
        ctx.filter = 'none';
    }
    ctx.drawImage(bitmap, source.x, source.y, source.width, source.height, dest.x, dest.y, dest.width, dest.height);

    const brandY = CARD_HEIGHT - PAD + 6;
    const title = fitTitle(ctx, text.title);
    const titleTop = brandY - 46 - title.lines.length * title.lineHeight;

    // A scrim from just above the title down, so the white text reads on any cover and the rest of the photo stays bright.
    const scrim = ctx.createLinearGradient(0, Math.max(0, titleTop - 80), 0, CARD_HEIGHT);
    scrim.addColorStop(0, 'rgba(0, 0, 0, 0)');
    scrim.addColorStop(0.4, 'rgba(0, 0, 0, 0.5)');
    scrim.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    ctx.font = title.size === TITLE_SIZE ? TITLE_FONT : TITLE_LARGE_FONT;
    ctx.fillStyle = '#FFFFFF';
    drawLines(ctx, title.lines, titleTop, title.lineHeight, title.size);
    // Same footer as the paper card: the author on the left, the brand on the right.
    drawAuthor(ctx, text.author, brandY, '#FFFFFF');
    drawBrand(ctx, logo, CARD_WIDTH - PAD, brandY, '#FFFFFF', 'right');
}

/** The logo, or null when it can't be loaded: the card then shows the wordmark alone. */
async function loadLogo(): Promise<ImageBitmap | null> {
    try {
        const res = await fetch('/logo.webp');
        return res.ok ? await createImageBitmap(await res.blob()) : null;
    } catch {
        return null;
    }
}

/** Load the card's fonts, so the canvas doesn't draw a fallback face. */
async function loadFonts(): Promise<void> {
    await Promise.all([TITLE_FONT, TITLE_LARGE_FONT, EXCERPT_FONT, AUTHOR_FONT, WORDMARK_FONT].map((font) => document.fonts.load(font)));
    await document.fonts.ready;
}

/** Whether this browser can draw the card (OffscreenCanvas + createImageBitmap). */
export function canRenderCardImage(): boolean {
    return typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
}

/** Draw the 1200×630 card of a note, over its cover when it has one, and return it as a JPEG. */
export async function renderCardImage(text: CardText, cover?: CardCover): Promise<Blob> {
    const [bitmap, logo] = await Promise.all([
        cover ? createImageBitmap(cover.image) : null,
        loadLogo(),
        loadFonts(),
    ]);
    try {
        const canvas = new OffscreenCanvas(CARD_WIDTH, CARD_HEIGHT);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D canvas context');
        if (bitmap && cover) drawCoverCard(ctx, bitmap, cover.positionY, text, logo);
        else drawPaperCard(ctx, text, logo);
        return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    } finally {
        bitmap?.close();
        logo?.close();
    }
}
