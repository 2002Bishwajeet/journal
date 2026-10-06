// The 1200×630 link-card image of a public note's cover (#441). Loaded with a
// dynamic import() from the publish/save path and the share dialog.

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

/** Whether this browser can draw the card (OffscreenCanvas + createImageBitmap). */
export function canRenderCardImage(): boolean {
    return typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function';
}

/** Draw the 1200×630 card of a cover image and return it as a JPEG. */
export async function renderCardImage(image: Blob, positionY: number): Promise<Blob> {
    const bitmap = await createImageBitmap(image);
    try {
        const canvas = new OffscreenCanvas(CARD_WIDTH, CARD_HEIGHT);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No 2D canvas context');
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
        return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    } finally {
        bitmap.close();
    }
}
