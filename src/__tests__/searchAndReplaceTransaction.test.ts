// @vitest-environment happy-dom
/**
 * Regression: replaceCurrentMatch/replaceAllMatches used to read `editor.state`
 * and call `editor.view.dispatch(...)` directly instead of using the command
 * chain's own `tr`/`dispatch`/`state`. That breaks composition inside
 * `editor.chain()....run()` — a nested mid-chain dispatch advances `editor.state`
 * out from under the chain's own accumulated transaction, so the chain's final
 * `.run()` dispatch throws "Applying a mismatched transaction" (ProseMirror's
 * `tr.before.eq(this.doc)` check fails). It also split one logical replace into
 * two separate undo steps.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { createTrackedEditor } from './trackedEditor';
import StarterKit from '@tiptap/starter-kit';
import { SearchAndReplace, searchPluginKey } from '@/components/editor/plugins/SearchAndReplaceExtension';

function mkEditor(content: string) {
    const el = document.createElement('div');
    return createTrackedEditor({
        element: el,
        extensions: [StarterKit, SearchAndReplace],
        content,
    });
}

describe('SearchAndReplace replace commands compose with the chain', () => {
    let editor: Editor;

    beforeEach(() => {
        editor = mkEditor('<p>foo bar foo baz foo</p>');
        editor.commands.updateSearch({ searchTerm: 'foo', caseSensitive: false, wholeWord: false });
    });

    it('replaceCurrentMatch composed inside a chain with another command does not throw', () => {
        expect(() => {
            editor.chain().focus().replaceCurrentMatch('X').run();
        }).not.toThrow();
        expect(editor.getText()).toBe('X bar foo baz foo');
    });

    it('replaceAllMatches replaces every match without throwing', () => {
        expect(() => {
            editor.commands.replaceAllMatches('X');
        }).not.toThrow();
        expect(editor.getText()).toBe('X bar X baz X');
    });

    it('replaceCurrentMatch is a single undo step', () => {
        editor.chain().replaceCurrentMatch('X').run();
        expect(editor.getText()).toBe('X bar foo baz foo');

        editor.commands.undo();
        expect(editor.getText()).toBe('foo bar foo baz foo');
    });

    it('replaceAllMatches is a single undo step', () => {
        editor.commands.replaceAllMatches('X');
        expect(editor.getText()).toBe('X bar X baz X');

        editor.commands.undo();
        expect(editor.getText()).toBe('foo bar foo baz foo');
    });
});

describe('openFind(term)', () => {
    it('stores the term for the find bar to take, and opens without one', () => {
        const editor = mkEditor('<p>foo bar foo</p>');
        editor.commands.openFind('foo');
        expect(editor.storage.searchAndReplace.isOpen).toBe(true);
        expect(editor.storage.searchAndReplace.pendingTerm).toBe('foo');

        editor.commands.closeSearch();
        expect(editor.storage.searchAndReplace.pendingTerm).toBeNull();
        editor.commands.openFind();
        expect(editor.storage.searchAndReplace.pendingTerm).toBeNull();
    });

    it('has results once the bar applies the term, and goToCurrentMatch stays on the first', () => {
        const editor = mkEditor('<p>foo bar foo</p>');
        editor.commands.openFind('foo');
        const term = editor.storage.searchAndReplace.pendingTerm as string;
        editor.commands.updateSearch({ searchTerm: term, caseSensitive: false, wholeWord: false });

        const state = searchPluginKey.getState(editor.state);
        expect(state.results).toHaveLength(2);
        expect(state.currentIndex).toBe(0);
        expect(editor.commands.goToCurrentMatch()).toBe(true);
        expect(searchPluginKey.getState(editor.state).currentIndex).toBe(0);
        expect(editor.state.selection.from).toBe(state.results[0].from);
    });

    it('opens Replace only on an editable note', () => {
        const editor = mkEditor('<p>foo</p>');
        editor.commands.openReplace();
        expect(editor.storage.searchAndReplace.isReplaceOpen).toBe(true);

        editor.setEditable(false);
        editor.commands.openReplace();
        expect(editor.storage.searchAndReplace.isOpen).toBe(true);
        expect(editor.storage.searchAndReplace.isReplaceOpen).toBe(false);
    });
});
