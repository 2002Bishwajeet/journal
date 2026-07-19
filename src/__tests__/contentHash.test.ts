/**
 * computeContentHash must cover every metadata field that pushNote serializes into the
 * remote note, so a metadata-only change (e.g. a pin toggle) produces a different hash and
 * actually uploads (BUG-06). Timestamps are deliberately excluded — they change on every
 * save even when nothing meaningful changed.
 */
import { describe, it, expect } from 'vitest';
import { computeContentHash } from '@/lib/utils/hash';
import type { DocumentMetadata } from '@/types';

const meta = (over: Partial<DocumentMetadata> = {}): DocumentMetadata =>
    ({
        title: 'Note',
        folderId: 'main',
        tags: [],
        excludeFromAI: false,
        timestamps: { created: '2020-01-01T00:00:00.000Z', modified: '2020-01-01T00:00:00.000Z' },
        ...over,
    } as DocumentMetadata);

const blob = new Uint8Array([1, 2, 3]);

describe('computeContentHash', () => {
    it('is stable for the same input', async () => {
        const a = await computeContentHash(meta(), blob);
        const b = await computeContentHash(meta(), blob);
        expect(a).toBe(b);
    });

    it('changes when isPinned flips', async () => {
        const unpinned = await computeContentHash(meta({ isPinned: false }), blob);
        const pinned = await computeContentHash(meta({ isPinned: true }), blob);
        expect(pinned).not.toBe(unpinned);
    });

    it('does NOT change when only the timestamps change', async () => {
        const original = await computeContentHash(meta(), blob);
        const laterTimestamps = await computeContentHash(
            meta({ timestamps: { created: '2020-01-01T00:00:00.000Z', modified: '2099-12-31T23:59:59.000Z' } }),
            blob,
        );
        expect(laterTimestamps).toBe(original);
    });
});
