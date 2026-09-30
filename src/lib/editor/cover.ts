import * as Y from 'yjs';

/** Y.Map in the note's Yjs doc that holds note-level data outside the body. */
export const COVER_MAP = 'journalMeta';
const COVER_KEY = 'cover';

export interface NoteCover {
    /** `attachment://<fileId>/<payloadKey>` once uploaded, a session `blob:` URL while pending. */
    src: string;
    /** Upload queue id while the bytes are still pending. */
    pendingId?: string;
    /** Vertical focal point, 0–100. */
    positionY: number;
}

const ATTACHMENT_SRC = /^attachment:\/\/([^/]+)\/([^/]+)$/;

function isNoteCover(value: unknown): value is NoteCover {
    if (!value || typeof value !== 'object') return false;
    const { src, pendingId, positionY } = value as Record<string, unknown>;
    return typeof src === 'string'
        && (ATTACHMENT_SRC.test(src) || src.startsWith('blob:'))
        && (pendingId === undefined || typeof pendingId === 'string')
        && typeof positionY === 'number'
        && positionY >= 0 && positionY <= 100;
}

export function getCover(ydoc: Y.Doc): NoteCover | null {
    const value = ydoc.getMap(COVER_MAP).get(COVER_KEY);
    if (!isNoteCover(value)) return null;
    return {
        src: value.src,
        ...(value.pendingId ? { pendingId: value.pendingId } : {}),
        positionY: value.positionY,
    };
}

export function setCover(ydoc: Y.Doc, cover: NoteCover): void {
    ydoc.getMap(COVER_MAP).set(COVER_KEY, {
        src: cover.src,
        ...(cover.pendingId ? { pendingId: cover.pendingId } : {}),
        positionY: cover.positionY,
    });
}

export function clearCover(ydoc: Y.Doc): void {
    ydoc.getMap(COVER_MAP).delete(COVER_KEY);
}

export function setCoverPosition(ydoc: Y.Doc, y: number): void {
    const cover = getCover(ydoc);
    if (!cover || !Number.isFinite(y)) return;
    setCover(ydoc, { ...cover, positionY: Math.min(100, Math.max(0, Math.round(y))) });
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
