import * as Y from 'yjs';
import type { DocumentMetadata } from '@/types';
import { coverPayloadKey, getCover } from '@/lib/editor/cover';
import { PAYLOAD_KEY_CARD_IMAGE } from '@/lib/homebase/config';

/** What a card image is drawn from (#434): a redraw is due when any of it changes. */
export interface CardImageFrom {
    title: string;
    /** The card's description: the share description or the first paragraph. */
    excerpt?: string;
    /** The uploaded cover. Without one the card is the designed paper card. */
    cover?: { src: string; positionY: number };
}

/** Whether two card images would be drawn the same. */
export function sameCardImageFrom(a: CardImageFrom | undefined, b: CardImageFrom): boolean {
    return a?.title === b.title
        // A cover card draws no excerpt.
        && (b.cover !== undefined || a.excerpt === b.excerpt)
        && a.cover?.src === b.cover?.src
        && a.cover?.positionY === b.cover?.positionY;
}

/** Link-card data a public note publishes in its plaintext header content. */
export interface PublicCard {
    description?: string;
    /** The raw cover payload: og:image for notes published before card images. */
    coverKey?: string;
    /** The 1200×630 card image payload (#441, #434), drawn from `cardImageFrom`. */
    cardImageKey?: string;
    cardImageFrom?: CardImageFrom;
    indexable?: boolean;
}

const TEXT_BLOCKS = new Set(['paragraph', 'blockquote']);

function nodeText(node: Y.XmlElement | Y.XmlText): string {
    if (node instanceof Y.XmlText) {
        return (node.toDelta() as Array<{ insert?: unknown }>)
            .map((op) => (typeof op.insert === 'string' ? op.insert : '')) // ignore embeds
            .join('');
    }
    return node
        .toArray()
        .filter((child): child is Y.XmlElement | Y.XmlText =>
            child instanceof Y.XmlElement || child instanceof Y.XmlText)
        .map(nodeText)
        .join(' ');
}

/**
 * Whitespace-collapsed text of the first top-level paragraph or blockquote with
 * any text. Headings, code blocks, tables, lists and math are skipped.
 */
export function firstParagraphText(ydoc: Y.Doc): string {
    for (const node of ydoc.getXmlFragment('prosemirror').toArray()) {
        if (!(node instanceof Y.XmlElement) || !TEXT_BLOCKS.has(node.nodeName)) continue;
        const text = nodeText(node).replace(/\s+/g, ' ').trim();
        if (text) return text;
    }
    return '';
}

/** Cut text longer than `max` at the last space before `max` and append `…`. */
export function truncateAtWord(text: string, max = 200): string {
    if (text.length <= max) return text;
    const cut = text.lastIndexOf(' ', max);
    return `${text.slice(0, cut > 0 ? cut : max)}…`;
}

export function buildPublicCard(
    yjsBlob: Uint8Array | undefined,
    meta: Pick<DocumentMetadata, 'shareDescription' | 'shareIndexable'> & { title?: string }
): PublicCard {
    const card: PublicCard = {};

    const custom = meta.shareDescription?.trim();
    if (custom) {
        card.description = truncateAtWord(custom, 300);
    }

    if (yjsBlob) {
        // Decode once. Best-effort: an undecodable blob just means no derived
        // description and no cover, never a failed save/publish.
        const doc = new Y.Doc();
        try {
            Y.applyUpdate(doc, yjsBlob);
            if (!custom) {
                const text = firstParagraphText(doc);
                if (text) card.description = truncateAtWord(text);
            }
            // Only an uploaded cover has a payload the guest thumb endpoint can serve.
            const cover = getCover(doc);
            const coverKey = cover && !cover.pendingId ? coverPayloadKey(cover.src) : null;
            if (cover && coverKey) card.coverKey = coverKey;
            // Every note gets a card image (#434): one without an uploaded cover is the designed card.
            card.cardImageKey = PAYLOAD_KEY_CARD_IMAGE;
            card.cardImageFrom = {
                title: meta.title?.trim() || 'Untitled',
                ...(card.description && { excerpt: card.description }),
                ...(cover && coverKey && { cover: { src: cover.src, positionY: cover.positionY } }),
            };
        } catch (e) {
            if (!custom) console.error('[publicCard] failed to read the note content', e);
        } finally {
            doc.destroy();
        }
    }

    if (meta.shareIndexable === true) card.indexable = true;
    return card;
}

/**
 * The description a link card shows when the note has none of its own.
 * Must stay in sync with fallbackShareDescription in functions/_lib/shareMeta.ts
 * (the Pages Function passes the profile name where the dialog passes the identity).
 */
export function fallbackShareDescription(author: string): string {
    return `A note by ${author}, shared with Journal`;
}

export interface ShareCardPatch {
    shareDescription?: string;
    shareIndexable?: boolean;
}

/** Apply a share-dialog edit to note metadata. A blank description is stored as undefined. */
export function mergeShareCard<T extends Pick<DocumentMetadata, 'shareDescription' | 'shareIndexable'>>(
    metadata: T,
    patch: ShareCardPatch
): T {
    const next = { ...metadata };
    if (patch.shareDescription !== undefined) next.shareDescription = patch.shareDescription.trim() || undefined;
    if (patch.shareIndexable !== undefined) next.shareIndexable = patch.shareIndexable;
    return next;
}
