/**
 * The back stack each phone tab keeps (#859): push, pop, replace, the size limit
 * and restore after a reload.
 */
import { describe, it, expect } from 'vitest';
import { createTabStacks, MAX_TAB_STACK } from '@/layouts/tabStacks';

function memoryStore() {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('createTabStacks', () => {
    it('starts each tab at its root', () => {
        const stacks = createTabStacks(memoryStore());
        expect(stacks.entries('notes')).toEqual(['/']);
        expect(stacks.entries('shared')).toEqual(['/shared']);
    });

    it('pushes screens in order, one stack for each tab', () => {
        const stacks = createTabStacks(memoryStore());
        stacks.push('notes', '/');
        stacks.push('notes', '/projects');
        stacks.push('notes', '/projects/note-1');
        stacks.push('shared', '/shared');
        expect(stacks.entries('notes')).toEqual(['/', '/projects', '/projects/note-1']);
        expect(stacks.entries('shared')).toEqual(['/shared']);
    });

    it('keeps the query of a tag list', () => {
        const stacks = createTabStacks(memoryStore());
        stacks.push('notes', '/?tag=work');
        expect(stacks.entries('notes')).toEqual(['/?tag=work']);
    });

    it('pops to the screen Back landed on and drops what came after', () => {
        const stacks = createTabStacks(memoryStore());
        stacks.set('notes', ['/', '/projects', '/projects/note-1']);
        expect(stacks.popTo('notes', '/projects')).toBe(true);
        expect(stacks.entries('notes')).toEqual(['/', '/projects']);
        expect(stacks.popTo('notes', '/')).toBe(true);
        expect(stacks.entries('notes')).toEqual(['/']);
    });

    it('does not change the stack when popping to its top', () => {
        const stacks = createTabStacks(memoryStore());
        stacks.set('notes', ['/', '/projects']);
        expect(stacks.popTo('notes', '/projects')).toBe(true);
        expect(stacks.entries('notes')).toEqual(['/', '/projects']);
    });

    it('says so when a screen was never on the stack', () => {
        const stacks = createTabStacks(memoryStore());
        stacks.set('notes', ['/', '/projects']);
        expect(stacks.popTo('notes', '/other')).toBe(false);
        expect(stacks.entries('notes')).toEqual(['/', '/projects']);
    });

    it('replaces the current screen, and an empty stack just gets it', () => {
        const stacks = createTabStacks(memoryStore());
        stacks.replace('notes', '/projects');
        expect(stacks.entries('notes')).toEqual(['/projects']);
        stacks.push('notes', '/projects/note-1');
        stacks.replace('notes', '/projects/note-2');
        expect(stacks.entries('notes')).toEqual(['/projects', '/projects/note-2']);
    });

    it('drops the oldest screens past the size limit', () => {
        const stacks = createTabStacks(memoryStore());
        for (let i = 0; i < MAX_TAB_STACK + 5; i++) stacks.push('notes', `/f${i}`);
        const list = stacks.entries('notes');
        expect(list).toHaveLength(MAX_TAB_STACK);
        expect(list[0]).toBe('/f5');
        expect(list.at(-1)).toBe(`/f${MAX_TAB_STACK + 4}`);
    });

    it('restores the stacks after a reload', () => {
        const store = memoryStore();
        const before = createTabStacks(store);
        before.set('notes', ['/', '/projects', '/projects/note-1']);
        before.set('shared', ['/shared', '/shared/note-2']);

        const after = createTabStacks(store);
        expect(after.entries('notes')).toEqual(['/', '/projects', '/projects/note-1']);
        expect(after.entries('shared')).toEqual(['/shared', '/shared/note-2']);
    });

    it('starts empty from damaged or oversized saved data', () => {
        const damaged = memoryStore();
        damaged.setItem('journal-tab-stacks', '{not json');
        expect(createTabStacks(damaged).entries('notes')).toEqual(['/']);

        const oversized = memoryStore();
        const long = Array.from({ length: 50 }, (_, i) => `/f${i}`);
        oversized.setItem('journal-tab-stacks', JSON.stringify({ notes: long, shared: [1, '/shared'] }));
        const stacks = createTabStacks(oversized);
        expect(stacks.entries('notes')).toHaveLength(MAX_TAB_STACK);
        expect(stacks.entries('shared')).toEqual(['/shared']);
    });

    it('works without storage', () => {
        const stacks = createTabStacks(undefined);
        stacks.push('notes', '/projects');
        expect(stacks.entries('notes')).toEqual(['/projects']);
    });
});
