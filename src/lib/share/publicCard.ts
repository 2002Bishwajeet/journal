import * as Y from 'yjs';
import type { DocumentMetadata } from '@/types';
import { coverPayloadKey, getCoverFromBlob } from '@/lib/editor/cover';

/** Link-card data a public note publishes in its plaintext header content. */
export interface PublicCard {
    description?: string;
    coverKey?: string;
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
    meta: Pick<DocumentMetadata, 'shareDescription' | 'shareIndexable'>
): PublicCard {
    const card: PublicCard = {};

    const custom = meta.shareDescription?.trim();
    if (custom) {
        card.description = truncateAtWord(custom, 300);
    } else if (yjsBlob) {
        // Best-effort: an undecodable blob just means no derived description, never
        // a failed save/publish (mirrors extractPreviewTextFromYjs).
        const doc = new Y.Doc();
        try {
            Y.applyUpdate(doc, yjsBlob);
            const text = firstParagraphText(doc);
            if (text) card.description = truncateAtWord(text);
        } catch (e) {
            console.error('[publicCard] failed to read the note content', e);
        } finally {
            doc.destroy();
        }
    }

    if (yjsBlob) {
        // Only an uploaded cover has a payload the guest thumb endpoint can serve.
        const cover = getCoverFromBlob(yjsBlob);
        const coverKey = cover && !cover.pendingId ? coverPayloadKey(cover.src) : null;
        if (coverKey) card.coverKey = coverKey;
    }

    if (meta.shareIndexable === true) card.indexable = true;
    return card;
}
