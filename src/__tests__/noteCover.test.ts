import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
    COVER_MAP, getCover, setCover, clearCover, setCoverPosition, coverPayloadKey, getCoverFromBlob,
} from '@/lib/editor/cover';

describe('note cover', () => {
    it('round-trips setCover/getCover and clears', () => {
        const doc = new Y.Doc();
        expect(getCover(doc)).toBeNull();

        setCover(doc, { src: 'blob:abc', pendingId: 'p1', positionY: 50 });
        expect(getCover(doc)).toEqual({ src: 'blob:abc', pendingId: 'p1', positionY: 50 });

        setCover(doc, { src: 'attachment://f/jrnl_img0', positionY: 20 });
        expect(getCover(doc)).toEqual({ src: 'attachment://f/jrnl_img0', positionY: 20 });

        clearCover(doc);
        expect(getCover(doc)).toBeNull();
    });

    it('returns null for a malformed map value', () => {
        const doc = new Y.Doc();
        const map = doc.getMap(COVER_MAP);
        for (const bad of [
            'attachment://f/k',
            { src: 42, positionY: 50 },
            { src: 'attachment://f/k' },
            { src: 'attachment://f/k', positionY: '50' },
            { src: 'attachment://f/k', positionY: 150 },
            { src: 'https://tracker.example/pixel.gif', positionY: 50 },
            { src: 'blob:x', pendingId: 7, positionY: 50 },
        ]) {
            map.set('cover', bad);
            expect(getCover(doc)).toBeNull();
        }
    });

    it('setCoverPosition clamps and rounds', () => {
        const doc = new Y.Doc();
        setCover(doc, { src: 'attachment://f/k', positionY: 50 });

        setCoverPosition(doc, -5);
        expect(getCover(doc)?.positionY).toBe(0);
        setCoverPosition(doc, 140);
        expect(getCover(doc)?.positionY).toBe(100);
        setCoverPosition(doc, 33.6);
        expect(getCover(doc)?.positionY).toBe(34);
    });

    it('setCoverPosition is a no-op without a cover', () => {
        const doc = new Y.Doc();
        setCoverPosition(doc, 10);
        expect(getCover(doc)).toBeNull();
    });

    it('coverPayloadKey parses attachment srcs only', () => {
        expect(coverPayloadKey('attachment://abc/jrnl_img3')).toBe('jrnl_img3');
        expect(coverPayloadKey('blob:http://localhost/abc')).toBeNull();
    });

    it('getCoverFromBlob reads the cover from an encoded doc', () => {
        const doc = new Y.Doc();
        setCover(doc, { src: 'attachment://f/jrnl_img1', positionY: 70 });
        expect(getCoverFromBlob(Y.encodeStateAsUpdate(doc))).toEqual({ src: 'attachment://f/jrnl_img1', positionY: 70 });
        expect(getCoverFromBlob(Y.encodeStateAsUpdate(new Y.Doc()))).toBeNull();
    });

    it('concurrent covers converge after exchanging updates', () => {
        const a = new Y.Doc();
        const b = new Y.Doc();
        setCover(a, { src: 'attachment://f/jrnl_img1', positionY: 10 });
        setCover(b, { src: 'attachment://f/jrnl_img2', positionY: 90 });

        const fromA = Y.encodeStateAsUpdate(a);
        const fromB = Y.encodeStateAsUpdate(b);
        Y.applyUpdate(a, fromB);
        Y.applyUpdate(b, fromA);

        expect(getCover(a)).not.toBeNull();
        expect(getCover(a)).toEqual(getCover(b));
    });
});
