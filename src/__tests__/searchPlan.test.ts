import { describe, it, expect } from 'vitest';
import { buildSearchPlan, parseSearchQuery, toSearchFilters, tokenAtCaret } from '@/lib/search/searchPlan';
import { COLLABORATIVE_FOLDER_ID } from '@/lib/homebase/config';

// A fixed clock: 15 October 2026, 13:30 local time.
const NOW = new Date(2026, 9, 15, 13, 30);
const parse = (query: string) => parseSearchQuery(query, NOW);
const local = (year: number, month: number, day: number) => new Date(year, month - 1, day).toISOString();
const kinds = (query: string) => parse(query).tokens.map((t) => `${t.kind}:${t.value}`);

describe('parseSearchQuery', () => {
    it('takes tag:name and #name off the text, several tags at once', () => {
        expect(parse('budget tag:work')).toMatchObject({ text: 'budget ', tokens: [{ kind: 'tag', value: 'work', start: 7, end: 15 }] });
        expect(parse('#work budget')).toMatchObject({ text: ' budget', tokens: [{ kind: 'tag', value: 'work' }] });
        expect(kinds('#Work tag:recipe soup')).toEqual(['tag:Work', 'tag:recipe']);
        expect(buildSearchPlan(parse('budget tag:work').text)).toMatchObject({ text: 'budget', head: 'budget' });
    });

    it('takes folder:name and folder:"two words"', () => {
        expect(parse('folder:trav plan')).toMatchObject({ text: ' plan', tokens: [{ kind: 'folder', value: 'trav' }] });
        expect(parse('folder:"Work notes" plan')).toMatchObject({ text: ' plan', tokens: [{ kind: 'folder', value: 'Work notes', end: 19 }] });
    });

    it('takes is:pinned, is:shared and is:public in any case, and leaves another is: as text', () => {
        expect(kinds('is:pinned is:Shared IS:public')).toEqual(['is:pinned', 'is:shared', 'is:public']);
        expect(parse('is:starred')).toEqual({ text: 'is:starred', tokens: [] });
    });

    it('takes before: and after: as the start of a local date', () => {
        expect(parse('before:2026-10-01').tokens[0]).toMatchObject({ kind: 'before', value: '2026-10-01', at: local(2026, 10, 1) });
        expect(parse('after:2026-10').tokens[0].at).toBe(local(2026, 10, 1));
        expect(parse('after:2026').tokens[0].at).toBe(local(2026, 1, 1));
        expect(parse('before:2026').tokens[0].at).toBe(local(2026, 1, 1));
    });

    it('takes today, yesterday, week and month for after: only', () => {
        expect(parse('after:today').tokens[0].at).toBe(local(2026, 10, 15));
        expect(parse('after:yesterday').tokens[0].at).toBe(local(2026, 10, 14));
        expect(parse('after:week').tokens[0].at).toBe(local(2026, 10, 8));
        expect(parse('after:Month').tokens[0].at).toBe(local(2026, 9, 15));
        expect(parse('before:today').tokens).toEqual([]);
    });

    it('leaves a bad date as text', () => {
        for (const query of ['after:2026-13', 'after:2026-02-30', 'before:20261', 'after:26-10-01', 'after:soon', 'after:constructor']) {
            expect(parse(query)).toEqual({ text: query, tokens: [] });
        }
    });

    it('leaves an unknown word:, an empty value and a token in quotes as text', () => {
        for (const query of ['foo:bar', 'tag:', 'folder:', '#', '"tag:work"', '"tax tag:work return"', 'folder:""']) {
            expect(parse(query)).toEqual({ text: query, tokens: [] });
        }
    });

    it('combines a date filter with a phrase', () => {
        const { text, tokens } = parse('before:2026-01-01 "tax return"');
        expect(tokens.map((t) => t.kind)).toEqual(['before']);
        expect(buildSearchPlan(text)).toMatchObject({ text: '"tax return"', kind: 'syntax' });
    });
});

describe('toSearchFilters', () => {
    const folders = new Map([['f1', 'Travel'], ['f2', 'Work'], ['f3', 'Travel work']]);
    const filters = (query: string) => toSearchFilters(parse(query).tokens, folders);

    it('lowercases tags and keeps all of them', () => {
        expect(filters('#Work tag:Recipe')).toEqual({ tags: ['work', 'recipe'] });
    });

    it('resolves a folder name to every folder that contains it, in any case', () => {
        expect(filters('folder:trav')).toEqual({ folderIds: ['f1', 'f3'] });
        expect(filters('folder:TRAV folder:work')).toEqual({ folderIds: ['f3'] });
        expect(filters('folder:nowhere')).toEqual({ folderIds: [] });
    });

    it('takes folder:shared as the notes shared with me', () => {
        expect(filters('folder:shared').folderIds).toEqual([COLLABORATIVE_FOLDER_ID]);
    });

    it('takes the flags, and the latest after: and earliest before:', () => {
        expect(filters('is:pinned is:shared is:public')).toEqual({ pinned: true, shared: true, public: true });
        expect(filters('after:2026-01 after:2026-03 before:2026-09 before:2026-06')).toEqual({
            after: local(2026, 3, 1),
            before: local(2026, 6, 1),
        });
    });
});

describe('tokenAtCaret', () => {
    it('finds the filter being typed and the word to replace', () => {
        expect(tokenAtCaret('tag:re', 6)).toEqual({ key: 'tag', hash: false, value: 're', start: 0, end: 6 });
        expect(tokenAtCaret('soup #re', 8)).toEqual({ key: 'tag', hash: true, value: 're', start: 5, end: 8 });
        expect(tokenAtCaret('folder:"two wo', 14)).toMatchObject({ key: 'folder', value: 'two wo', start: 0, end: 14 });
        expect(tokenAtCaret('IS:', 3)).toMatchObject({ key: 'is', value: '' });
    });

    it('replaces the rest of the word after the caret too', () => {
        expect(tokenAtCaret('tag:recipe soup', 6)).toMatchObject({ value: 're', start: 0, end: 10 });
    });

    it('finds nothing after a space, in a phrase, or for another word', () => {
        expect(tokenAtCaret('tag:recipe ', 11)).toBeNull();
        expect(tokenAtCaret('"soup tag:re', 12)).toBeNull();
        expect(tokenAtCaret('foo:', 4)).toBeNull();
        expect(tokenAtCaret('c#', 2)).toBeNull();
    });
});

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
