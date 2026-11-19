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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createTrackedEditor } from './trackedEditor';
import StarterKit from '@tiptap/starter-kit';
import { SearchAndReplace, searchPluginKey } from '@/components/editor/plugins/SearchAndReplaceExtension';
import { Toggle } from '@/components/editor/nodes/ToggleNode';

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

    it('openFind, openReplace and closeSearch run inside a chain after a doc change', () => {
        const editor = mkEditor('<p>foo bar</p>');
        const run = (command: 'openFind' | 'openReplace' | 'closeSearch') => () =>
            editor.chain().insertContentAt(1, 'x')[command]().run();

        expect(run('openFind')).not.toThrow();
        expect(editor.storage.searchAndReplace.isOpen).toBe(true);
        expect(run('openReplace')).not.toThrow();
        expect(editor.storage.searchAndReplace.isReplaceOpen).toBe(true);
        expect(run('closeSearch')).not.toThrow();
        expect(editor.storage.searchAndReplace.isOpen).toBe(false);
        expect(editor.getText()).toBe('xxxfoo bar');
    });
});

// The reveal opens toggles in a microtask, then scrolls on the next frame.
const afterReveal = () => Promise.resolve().then(() => new Promise((r) => requestAnimationFrame(r)));

describe('navigating to a match (#1417)', () => {
    it('selects and scrolls to the only match on next and previous', async () => {
        const editor = mkEditor('<p>alpha</p><p>beta</p><p>gamma</p>');
        editor.commands.updateSearch({ searchTerm: 'gamma', caseSensitive: false, wholeWord: false });
        const scrolled = vi.fn();
        Element.prototype.scrollIntoView = scrolled;
        const match = searchPluginKey.getState(editor.state).results[0];

        editor.commands.setTextSelection(1);
        expect(editor.commands.goToNextMatch()).toBe(true);
        expect(editor.state.selection.from).toBe(match.from);
        await afterReveal();
        expect(scrolled).toHaveBeenCalledTimes(1);

        editor.commands.setTextSelection(1);
        expect(editor.commands.goToPrevMatch()).toBe(true);
        expect(editor.state.selection.from).toBe(match.from);
        await afterReveal();
        expect(scrolled).toHaveBeenCalledTimes(2);
        expect(scrolled).toHaveBeenLastCalledWith({ block: 'center', inline: 'center' });
    });

    it('keeps the count in step with the doc as it changes', () => {
        const editor = mkEditor('<p>open source</p>');
        editor.commands.updateSearch({ searchTerm: 'open source', caseSensitive: false, wholeWord: false });
        expect(searchPluginKey.getState(editor.state).results).toHaveLength(1);
        editor.commands.insertContentAt(editor.state.doc.content.size, '<p>more open source</p>');
        expect(searchPluginKey.getState(editor.state).results).toHaveLength(2);
    });

    it('opens a closed toggle around the match without a mismatched transaction', async () => {
        // ToggleNodeView's DOM, closed: <div data-type="toggle"><div><button aria-expanded="false">.
        // Its click dispatches a doc change, the worst case for a click made inside the find
        // command: before that command's own transaction it throws "Applying a mismatched transaction".
        const ClosedToggle = Toggle.extend({
            addNodeView() {
                return ({ editor, getPos }) => {
                    const dom = document.createElement('div');
                    dom.setAttribute('data-type', 'toggle');
                    const bar = dom.appendChild(document.createElement('div'));
                    bar.contentEditable = 'false';
                    const button = bar.appendChild(document.createElement('button'));
                    button.setAttribute('aria-expanded', 'false');
                    button.onclick = () => {
                        button.setAttribute('aria-expanded', 'true');
                        editor.view.dispatch(editor.state.tr.setNodeAttribute(getPos()!, 'summary', 'Opened'));
                    };
                    const contentDOM = dom.appendChild(document.createElement('div'));
                    return { dom, contentDOM, ignoreMutation: () => true };
                };
            },
        });
        const editor = createTrackedEditor({
            element: document.createElement('div'),
            extensions: [StarterKit, SearchAndReplace, ClosedToggle],
            content: '<p>alpha</p><div data-type="toggle" data-summary="Hidden"><p>the quuxplorg</p></div>',
        });
        const scrolled = vi.fn();
        Element.prototype.scrollIntoView = scrolled;
        editor.commands.updateSearch({ searchTerm: 'quuxplorg', caseSensitive: false, wholeWord: false });
        const match = searchPluginKey.getState(editor.state).results[0];
        const button = editor.view.dom.querySelector('[data-type="toggle"] button')!;

        expect(() => editor.commands.goToCurrentMatch()).not.toThrow();
        expect(editor.state.selection.from).toBe(match.from);
        await afterReveal();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(scrolled).toHaveBeenCalledWith({ block: 'center', inline: 'center' });
    });
});
