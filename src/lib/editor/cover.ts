import * as Y from 'yjs';

/** Y.Map in the note's Yjs doc that holds note-level data outside the body. */
export const COVER_MAP = 'journalMeta';
const COVER_KEY = 'cover';

/** One cover image. */
export interface CoverImage {
    /** `attachment://<fileId>/<payloadKey>` once uploaded, a session `blob:` URL while pending. */
    src: string;
    /** Upload queue id while the bytes are still pending. */
    pendingId?: string;
    /** Vertical focal point, 0–100. */
    positionY: number;
}

export interface NoteCover extends CoverImage {
    /** Optional cover shown when the viewer's theme is dark (#512). */
    dark?: CoverImage;
}

/** Which of a note's covers: the normal one, or the optional dark-mode one. */
export type CoverVariant = 'light' | 'dark';

/** Below this a cover still works, but the app shows a hint. Recommended is 2400×1260. */
export const MIN_COVER_SIZE = { width: 1200, height: 630 };

export function isBelowMinCoverSize(width: number, height: number): boolean {
    return width < MIN_COVER_SIZE.width || height < MIN_COVER_SIZE.height;
}

const ATTACHMENT_SRC = /^attachment:\/\/([^/]+)\/([^/]+)$/;

function isCoverImage(value: unknown): value is CoverImage {
    if (!value || typeof value !== 'object') return false;
    const { src, pendingId, positionY } = value as Record<string, unknown>;
    return typeof src === 'string'
        && (ATTACHMENT_SRC.test(src) || src.startsWith('blob:'))
        && (pendingId === undefined || typeof pendingId === 'string')
        && typeof positionY === 'number'
        && positionY >= 0 && positionY <= 100;
}

function coverImage(value: CoverImage): CoverImage {
    return {
        src: value.src,
        ...(value.pendingId ? { pendingId: value.pendingId } : {}),
        positionY: value.positionY,
    };
}

function writeCover(ydoc: Y.Doc, light: CoverImage, dark: CoverImage | undefined): void {
    ydoc.getMap(COVER_MAP).set(COVER_KEY, {
        ...coverImage(light),
        ...(dark ? { dark: coverImage(dark) } : {}),
    });
}

/** The note's cover. A malformed dark cover is dropped; the light one still shows. */
export function getCover(ydoc: Y.Doc): NoteCover | null {
    const value = ydoc.getMap(COVER_MAP).get(COVER_KEY);
    if (!isCoverImage(value)) return null;
    const dark = (value as { dark?: unknown }).dark;
    return {
        ...coverImage(value),
        ...(isCoverImage(dark) ? { dark: coverImage(dark) } : {}),
    };
}

/** The image to show: the dark cover when the theme is dark and one is set, else the light one. */
export function coverForTheme(cover: NoteCover, isDark: boolean): CoverImage {
    return isDark && cover.dark ? cover.dark : cover;
}

/** Set the light cover. The dark cover, if any, is left as it is. */
export function setCover(ydoc: Y.Doc, cover: CoverImage): void {
    writeCover(ydoc, cover, getCover(ydoc)?.dark);
}

/** Set the dark cover. A no-op without a light cover. */
export function setDarkCover(ydoc: Y.Doc, dark: CoverImage): void {
    const cover = getCover(ydoc);
    if (cover) writeCover(ydoc, cover, dark);
}

/** Remove the light cover, and the dark one with it. */
export function clearCover(ydoc: Y.Doc): void {
    ydoc.getMap(COVER_MAP).delete(COVER_KEY);
}

export function clearDarkCover(ydoc: Y.Doc): void {
    const cover = getCover(ydoc);
    if (cover?.dark) writeCover(ydoc, cover, undefined);
}

export function setCoverPosition(ydoc: Y.Doc, y: number, variant: CoverVariant = 'light'): void {
    const cover = getCover(ydoc);
    if (!cover || !Number.isFinite(y)) return;
    const positionY = Math.min(100, Math.max(0, Math.round(y)));
    if (variant === 'light') writeCover(ydoc, { ...cover, positionY }, cover.dark);
    else if (cover.dark) writeCover(ydoc, cover, { ...cover.dark, positionY });
}

/**
 * The focal point after dragging the cover by `deltaPx` (positive = down) on a
 * band `bandHeightPx` tall. Dragging the image down reveals more of its top, so
 * the focal point moves up; a full band height spans the whole 0–100 range.
 */
export function dragToPositionY(startY: number, deltaPx: number, bandHeightPx: number): number {
    if (bandHeightPx <= 0) return startY;
    const y = startY - (deltaPx / bandHeightPx) * 100;
    return Math.min(100, Math.max(0, Math.round(y)));
}

/** The payload key of an uploaded cover's `attachment://<fileId>/<key>` src, else null. */
export function coverPayloadKey(src: string): string | null {
    return ATTACHMENT_SRC.exec(src)?.[2] ?? null;
}

/** Read the cover from a stored Yjs blob, for callers without a live doc (share page, card). */
export function getCoverFromBlob(yjsBlob: Uint8Array): NoteCover | null {
    const ydoc = new Y.Doc();
    try {
        Y.applyUpdate(ydoc, yjsBlob);
        return getCover(ydoc);
    } catch {
        return null;
    } finally {
        ydoc.destroy();
    }
}
