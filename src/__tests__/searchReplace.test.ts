import { describe, it, expect } from 'vitest';
import {
    findMatchesInText,
    nextMatchIndex,
    prevMatchIndex,
    escapeRegex,
} from '@/lib/search/findReplace';

describe('escapeRegex', () => {
    it('should escape special regex characters', () => {
        expect(escapeRegex('$10.00')).toBe('\\$10\\.00');
        expect(escapeRegex('(a+b)*c')).toBe('\\(a\\+b\\)\\*c');
    });

    it('should leave normal text unchanged', () => {
        expect(escapeRegex('hello')).toBe('hello');
    });
});

describe('findMatchesInText', () => {
    it('should find all occurrences of a term', () => {
        const results = findMatchesInText('hello world hello', 'hello', false, false);
        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({ index: 0, length: 5 });
        expect(results[1]).toEqual({ index: 12, length: 5 });
    });

    it('should return empty array for empty search term', () => {
        expect(findMatchesInText('hello', '', false, false)).toEqual([]);
    });

    it('should return empty array for empty text', () => {
        expect(findMatchesInText('', 'hello', false, false)).toEqual([]);
    });

    it('should be case-insensitive by default', () => {
        const results = findMatchesInText('Hello HELLO hello', 'hello', false, false);
        expect(results).toHaveLength(3);
    });

    it('should respect case-sensitive flag', () => {
        const results = findMatchesInText('Hello HELLO hello', 'hello', true, false);
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({ index: 12, length: 5 });
    });

    it('should respect whole-word flag', () => {
        const results = findMatchesInText('hello helloworld world', 'hello', false, true);
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({ index: 0, length: 5 });
    });

    it('should handle special regex characters in search term', () => {
        const results = findMatchesInText('price is $10.00 or $10.00', '$10.00', false, false);
        expect(results).toHaveLength(2);
    });

    it('should handle case-sensitive and whole-word combined', () => {
        const results = findMatchesInText('Hello hello HELLO', 'Hello', true, true);
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({ index: 0, length: 5 });
    });

    it('should handle multi-word search', () => {
        const results = findMatchesInText('the quick brown fox', 'quick brown', false, false);
        expect(results).toHaveLength(1);
        expect(results[0]).toEqual({ index: 4, length: 11 });
    });

    it('should handle consecutive non-overlapping matches', () => {
        const results = findMatchesInText('aaaa', 'aa', false, false);
        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({ index: 0, length: 2 });
        expect(results[1]).toEqual({ index: 2, length: 2 });
    });

    it('should handle single character search', () => {
        const results = findMatchesInText('abcabc', 'a', false, false);
        expect(results).toHaveLength(2);
    });

    it('should handle search term longer than text', () => {
        const results = findMatchesInText('hi', 'hello world', false, false);
        expect(results).toEqual([]);
    });

    it('should handle unicode text', () => {
        const results = findMatchesInText('café café latte', 'café', false, false);
        expect(results).toHaveLength(2);
    });
});

describe('nextMatchIndex', () => {
    it('should advance to next index', () => {
        expect(nextMatchIndex(0, 5)).toBe(1);
        expect(nextMatchIndex(2, 5)).toBe(3);
    });

    it('should wrap around at the end', () => {
        expect(nextMatchIndex(4, 5)).toBe(0);
    });

    it('should return -1 for zero matches', () => {
        expect(nextMatchIndex(-1, 0)).toBe(-1);
    });

    it('should stay at 0 for single match', () => {
        expect(nextMatchIndex(0, 1)).toBe(0);
    });
});

describe('prevMatchIndex', () => {
    it('should go to previous index', () => {
        expect(prevMatchIndex(3, 5)).toBe(2);
        expect(prevMatchIndex(1, 5)).toBe(0);
    });

    it('should wrap around at the beginning', () => {
        expect(prevMatchIndex(0, 5)).toBe(4);
    });

    it('should return -1 for zero matches', () => {
        expect(prevMatchIndex(-1, 0)).toBe(-1);
    });

    it('should stay at 0 for single match', () => {
        expect(prevMatchIndex(0, 1)).toBe(0);
    });
});
