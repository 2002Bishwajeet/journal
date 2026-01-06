
import type { DocumentMetadata } from '@/types';

/**
 * Compute a SHA-256 hash of the note content (metadata + Yjs blob).
 * This is used to determine if the note has changed and needs to be synced.
 */
export async function computeContentHash(
    metadata: DocumentMetadata,
    yjsBlob?: Uint8Array
): Promise<string> {
    // Combine metadata and blob into a single buffer
    const metadataString = JSON.stringify({
        title: metadata.title,
        folderId: metadata.folderId,
        tags: metadata.tags,
        // Exclude timestamps as they change on every save even if content is same
        excludeFromAI: metadata.excludeFromAI,
    });

    const encoder = new TextEncoder();
    const metadataBytes = encoder.encode(metadataString);

    // Create a combined buffer
    const blobLength = yjsBlob ? yjsBlob.length : 0;
    const combinedBuffer = new Uint8Array(metadataBytes.length + blobLength);

    combinedBuffer.set(metadataBytes);
    if (yjsBlob) {
        combinedBuffer.set(yjsBlob, metadataBytes.length);
    }

    // Compute SHA-256 hash using Web Crypto API
    if (typeof crypto !== 'undefined' && crypto.subtle) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', combinedBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    } else {
        // Fallback for non-browser environments (e.g. tests running in Node without web crypto polyfill)
        // Simple DJB2 hash for fallback (not cryptographically secure but good enough for change detection in tests)
        let hash = 5381;
        for (let i = 0; i < combinedBuffer.length; i++) {
            hash = ((hash << 5) + hash) + combinedBuffer[i]; /* hash * 33 + c */
        }
        return hash.toString(16);
    }
}
