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
import StarterKit from '@tiptap/starter-kit';
import { SearchAndReplace } from '@/components/editor/plugins/SearchAndReplaceExtension';

function mkEditor(content: string) {
    const el = document.createElement('div');
    return new Editor({
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
