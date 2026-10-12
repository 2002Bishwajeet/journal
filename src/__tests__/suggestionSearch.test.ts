import { describe, it, expect, beforeAll } from 'vitest';
import type { ResolvedPos } from '@tiptap/pm/model';
import { createSpacedSuggestionMatch, rankSearch } from '@/components/editor/plugins/suggestionSearch';
import { loadEmojiKeywords, searchEmojis } from '@/components/editor/plugins/emojiData';
import { filterCommands, slashCommandItems } from '@/components/editor/plugins/SlashCommands/slashCommandItems';

// #580: ranked emoji / slash search with spaces and aliases.

/** Minimal $position: cursor at the end of a paragraph whose text is `text`. */
function at(text: string, start = 1) {
    return {
        pos: start + text.length,
        parentOffset: text.length,
        parent: { textBetween: (from: number, to: number) => text.slice(from, to) },
    } as unknown as ResolvedPos;
}

describe('createSpacedSuggestionMatch', () => {
    const match = createSpacedSuggestionMatch('/')!;
    const query = (text: string) => match({ $position: at(text) } as Parameters<typeof match>[0])?.query ?? null;

    it('keeps single spaces in the query', () => {
        expect(query('/heading 4')).toBe('heading 4');
        expect(query('/code ')).toBe('code ');
        expect(query('intro /code block')).toBe('code block');
        expect(query('/')).toBe('');
    });

    it('stops at a double space, a leading space or a second trigger char', () => {
        expect(query('/heading  ')).toBeNull();
        expect(query('/heading  4')).toBeNull();
        expect(query('/ this is prose')).toBeNull();
        expect(query('a / b')).toBeNull();
        expect(query('/usr/bin')).toBeNull();
    });

    it('needs whitespace or block start before the trigger', () => {
        expect(query('and/or')).toBeNull();
        expect(match({ $position: at(':thumbs up') } as Parameters<typeof match>[0])).toBeNull();
    });

    it('returns a range that ends at the cursor', () => {
        const res = match({ $position: at('go /h4', 1) } as Parameters<typeof match>[0]);
        expect(res).toEqual({ range: { from: 4, to: 7 }, query: 'h4', text: '/h4' });
    });

    it('works for the emoji trigger', () => {
        const emoji = createSpacedSuggestionMatch(':')!;
        const q = (text: string) => emoji({ $position: at(text) } as Parameters<typeof emoji>[0])?.query ?? null;
        expect(q(':thumbs up')).toBe('thumbs up');
        expect(q('Time: now')).toBeNull();
        expect(q(':smile:')).toBeNull();
    });
});

describe('rankSearch', () => {
    const items = [
        { id: 'substring', names: ['blueberry'], keywords: [] },
        { id: 'word-prefix', names: ['big berry'], keywords: [] },
        { id: 'keyword-exact', names: ['other'], keywords: ['berry'] },
        { id: 'prefix', names: ['berry pie'], keywords: [] },
        { id: 'exact', names: ['berry'], keywords: [] },
        { id: 'none', names: ['apple'], keywords: ['fruit'] },
    ];
    const rank = (q: string, limit?: number) => rankSearch(items, q, (i) => i, limit).map((i) => i.id);

    it('orders exact > prefix > word-prefix > substring, names before keywords', () => {
        expect(rank('berry')).toEqual(['exact', 'keyword-exact', 'prefix', 'word-prefix', 'substring']);
    });

    it('matches multi-word queries only when every word matches', () => {
        expect(rank('big ber')).toEqual(['word-prefix']);
        expect(rank('berry zzz')).toEqual([]);
    });

    it('is case and whitespace insensitive, and treats _ as a space', () => {
        expect(rank('  BIG   Berry ')).toEqual(['word-prefix']);
        expect(rank('big_berry')).toEqual(['word-prefix']);
    });

    it('returns items unchanged for an empty query and applies the limit', () => {
        expect(rank('')).toEqual(items.map((i) => i.id));
        expect(rank('berry', 2)).toEqual(['exact', 'keyword-exact']);
    });
});

describe('emoji search', () => {
    beforeAll(() => loadEmojiKeywords());
    const top = (q: string, n = 1) => searchEmojis(q).slice(0, n).map((e) => e.emoji);

    it(':thumbs up shows 👍 first', () => {
        expect(top('thumbs up')).toEqual(['👍']);
        expect(top('thumbsup')).toEqual(['👍']);
    });

    it(':lol shows 😂 or 🤣 in the top 3', () => {
        const top3 = top('lol', 3);
        expect(top3.some((e) => e === '😂' || e === '🤣')).toBe(true);
    });

    it(':heart shows ❤️ first', () => {
        expect(top('heart')).toEqual(['❤️']);
    });

    it('finds slang through emojilib keywords', () => {
        expect(top('haha', 5)).toContain('😂');
        expect(top('party', 15)).toContain('🎉');
        expect(top('okay', 3)).toContain('👌');
    });

    it('caps results at 50 and returns nothing for prose', () => {
        expect(searchEmojis('a').length).toBe(50);
        expect(searchEmojis('this is prose')).toEqual([]);
    });
});

describe('slash command search', () => {
    const titles = (q: string) => filterCommands(slashCommandItems, q).map((c) => c.title);

    it('/heading 4 and /h4 show Heading 4 first', () => {
        expect(titles('heading 4')[0]).toBe('Heading 4');
        expect(titles('h4')[0]).toBe('Heading 4');
    });

    it('/todo finds Task List, /img finds Image', () => {
        expect(titles('todo')[0]).toBe('Task List');
        expect(titles('img')[0]).toBe('Image');
    });

    it('/heading lists the headings in order', () => {
        expect(titles('heading').slice(0, 6)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Heading ${n}`));
    });

    it('ranks an exact title above a substring match in another group', () => {
        expect(titles('ask')[0]).toBe('Ask AI');
    });

    it('matches nothing for prose', () => {
        expect(titles('this is prose')).toEqual([]);
    });

    it('every command has keywords', () => {
        for (const item of slashCommandItems) expect(item.keywords.length).toBeGreaterThan(0);
    });
});
