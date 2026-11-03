// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
    pushRecentNote,
    pushRecentSearch,
    resolveRecentNotes,
    applyRecentBoost,
    loadRecentNotes,
    loadRecentSearches,
    saveRecentNotes,
    type RecentNote,
} from '@/lib/recentItems';
import { RECENT_NOTES_KEY, RECENT_SEARCHES_KEY } from '@/lib/storage';

describe('pushRecentNote', () => {
    it('moves a note to the front without a duplicate', () => {
        let items: RecentNote[] = [];
        items = pushRecentNote(items, 'a', 1);
        items = pushRecentNote(items, 'b', 2);
        items = pushRecentNote(items, 'a', 3);
        expect(items).toEqual([{ docId: 'a', openedAt: 3 }, { docId: 'b', openedAt: 2 }]);
    });

    it('keeps at most 20', () => {
        let items: RecentNote[] = [];
        for (let i = 0; i < 25; i++) items = pushRecentNote(items, `n${i}`, i);
        expect(items).toHaveLength(20);
        expect(items[0].docId).toBe('n24');
    });
});

describe('pushRecentSearch', () => {
    it('dedupes case-insensitively and keeps the newest spelling', () => {
        expect(pushRecentSearch(pushRecentSearch([], 'Yak'), ' yak ')).toEqual(['yak']);
    });

    it('ignores empty and whitespace-only queries', () => {
        expect(pushRecentSearch([], '')).toEqual([]);
        expect(pushRecentSearch(['a'], '   ')).toEqual(['a']);
    });

    it('keeps at most 5', () => {
        let items: string[] = [];
        for (let i = 0; i < 8; i++) items = pushRecentSearch(items, `q${i}`);
        expect(items).toEqual(['q7', 'q6', 'q5', 'q4', 'q3']);
    });
});

describe('resolveRecentNotes', () => {
    const doc = (docId: string, archivalStatus?: number) => ({ docId, metadata: { archivalStatus } });

    it('drops missing, archived and trashed notes and keeps the stored order', () => {
        const recent = ['c', 'gone', 'a', 'arch', 'trash', 'b'].map((docId) => ({ docId, openedAt: 0 }));
        const docs = [doc('a', 0), doc('b'), doc('c', 0), doc('arch', 1), doc('trash', 2)];
        expect(resolveRecentNotes(recent, docs).map((d) => d.docId)).toEqual(['c', 'a', 'b']);
    });

    it('returns at most 8', () => {
        const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
        const result = resolveRecentNotes(ids.map((docId) => ({ docId, openedAt: 0 })), ids.map((id) => doc(id)));
        expect(result).toHaveLength(8);
    });
});

describe('applyRecentBoost', () => {
    it('moves a recent note above a non-recent note with an almost equal score', () => {
        const results = [{ docId: 'x', score: 1.0 }, { docId: 'r', score: 0.95 }];
        expect(applyRecentBoost(results, ['r']).map((r) => r.docId)).toEqual(['r', 'x']);
    });

    it('does not move a recent note above a clearly higher score', () => {
        const results = [{ docId: 'title', score: 10 }, { docId: 'r', score: 0.5 }];
        expect(applyRecentBoost(results, ['r']).map((r) => r.docId)).toEqual(['title', 'r']);
    });

    it('is stable for equal scores and without recents', () => {
        const results = [{ docId: 'a', score: 1 }, { docId: 'b', score: 1 }];
        expect(applyRecentBoost(results, ['z'])).toEqual(results);
        expect(applyRecentBoost(results, [])).toBe(results);
    });
});

describe('stored data', () => {
    beforeEach(() => localStorage.clear());

    it('round-trips', () => {
        saveRecentNotes([{ docId: 'a', openedAt: 1 }]);
        expect(loadRecentNotes()).toEqual([{ docId: 'a', openedAt: 1 }]);
    });

    it('yields an empty list for corrupt or old-format data', () => {
        for (const raw of ['not json{', '["a","b"]', 'null', '{"_v":2,"items":[]}', '{"_v":1,"items":"x"}']) {
            localStorage.setItem(RECENT_NOTES_KEY, raw);
            localStorage.setItem(RECENT_SEARCHES_KEY, raw);
            expect(loadRecentNotes()).toEqual([]);
            expect(loadRecentSearches()).toEqual([]);
        }
    });

    it('drops items of the wrong shape', () => {
        localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify({ _v: 1, items: [{ docId: 'a', openedAt: 1 }, 5, { docId: 3 }] }));
        expect(loadRecentNotes()).toEqual([{ docId: 'a', openedAt: 1 }]);
    });
});
