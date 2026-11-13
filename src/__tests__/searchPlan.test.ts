import { describe, it, expect } from 'vitest';
import { buildSearchPlan } from '@/lib/search/searchPlan';

describe('buildSearchPlan', () => {
    it('splits the last word off as a prefix while it is typed', () => {
        expect(buildSearchPlan('  zeppelin init ')).toMatchObject({ text: 'zeppelin init', head: 'zeppelin init', prefix: '' });
        expect(buildSearchPlan('zeppelin init')).toMatchObject({ head: 'zeppelin', prefix: 'init', kind: 'words' });
    });

    it('takes no prefix after a trailing space', () => {
        expect(buildSearchPlan('meeting ')).toMatchObject({ text: 'meeting', head: 'meeting', prefix: '' });
    });

    it('takes one character as the prefix', () => {
        expect(buildSearchPlan('a')).toMatchObject({ head: '', prefix: 'a', kind: 'words' });
    });

    it('keeps a phrase in quotes whole, closed or still open', () => {
        expect(buildSearchPlan('"garden recipe"')).toMatchObject({ head: '"garden recipe"', prefix: '', kind: 'syntax' });
        expect(buildSearchPlan('"garden reci')).toMatchObject({ head: '"garden reci', prefix: '' });
        expect(buildSearchPlan('"garden recipe" tom')).toMatchObject({ head: '"garden recipe"', prefix: 'tom' });
    });

    it('never takes an excluded -word as the prefix', () => {
        expect(buildSearchPlan('garden -recipe')).toMatchObject({ head: 'garden -recipe', prefix: '', kind: 'syntax' });
    });

    it('treats a hyphen inside a word as a word, not as an exclusion', () => {
        expect(buildSearchPlan('follow-up')).toMatchObject({ head: 'follow-up', prefix: '', kind: 'words' });
    });

    it('takes no prefix when the last word has punctuation, and marks the query as symbols', () => {
        expect(buildSearchPlan('hello world!')).toMatchObject({ head: 'hello world!', prefix: '', kind: 'symbols' });
        expect(buildSearchPlan('node.js')).toMatchObject({ prefix: '', kind: 'symbols' });
    });

    it('keeps stop words as plain words (the database drops them)', () => {
        expect(buildSearchPlan('the and')).toMatchObject({ head: 'the', prefix: 'and', kind: 'words' });
    });

    it('escapes LIKE wildcards and the escape character', () => {
        expect(buildSearchPlan('a_b')).toMatchObject({ like: 'a\\_b', kind: 'symbols', prefix: '' });
        expect(buildSearchPlan('100%')).toMatchObject({ like: '100\\%', kind: 'symbols' });
        expect(buildSearchPlan('C:\\temp').like).toBe('C:\\\\temp');
    });

    it('matches letters of any script', () => {
        expect(buildSearchPlan('会議 メモ')).toMatchObject({ head: '会議', prefix: 'メモ', kind: 'words' });
    });

    it('returns an empty text for a blank query', () => {
        expect(buildSearchPlan('   ').text).toBe('');
    });
});
