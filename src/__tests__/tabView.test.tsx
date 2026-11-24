// @vitest-environment happy-dom
/**
 * A desktop tab unmounted to free memory (useMountedTabs, #1487) comes back with its
 * note's scroll offset and selection; closing the tab forgets them.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { useTabView, forgetTabViews } from '@/hooks/useTabView';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // A scroller tall enough to scroll, in a DOM without layout
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 500 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 3000 });
});

afterAll(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollHeight');
});

const DOC = 'note-1';
const content = '<p>' + 'A long paragraph of the note. '.repeat(20) + '</p><p>Second paragraph.</p>';

let root: Root;
let host: HTMLDivElement;
const editors: Editor[] = [];

afterEach(async () => {
    await act(async () => root?.unmount());
    host?.remove();
    for (const editor of editors.splice(0)) editor.destroy();
    forgetTabViews(new Set());
});

function newEditor() {
    const editor = new Editor({ extensions: createBaseExtensions(), content });
    editors.push(editor);
    return editor;
}

/** The note's scroller. */
function Tab({ editor, enabled = true }: { editor: Editor; enabled?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useTabView(DOC, editor, false, ref, enabled);
    return <div ref={ref} />;
}

const scroller = () => host.firstElementChild as HTMLElement;

async function mount(editor: Editor, enabled = true) {
    host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    await act(async () => root.render(<Tab editor={editor} enabled={enabled} />));
}

async function unmount() {
    await act(async () => root.unmount());
    host.remove();
}

/** Leaves the tab scrolled to 800 with a selection over 5–12. */
async function leaveTab() {
    const editor = newEditor();
    await mount(editor);
    editor.commands.setTextSelection({ from: 5, to: 12 });
    scroller().scrollTop = 800;
    scroller().dispatchEvent(new Event('scroll'));
    await unmount();
}

describe('useTabView', () => {
    it('puts a remounted tab back at its scroll offset and selection', async () => {
        await leaveTab();

        const editor = newEditor();
        await mount(editor);
        expect(editor.state.selection.anchor).toBe(5);
        expect(editor.state.selection.head).toBe(12);
        expect(scroller().scrollTop).toBe(800);
    });

    it('starts a reopened note at the top once its tab was closed', async () => {
        await leaveTab();
        forgetTabViews(new Set(['another-note']));

        const editor = newEditor();
        await mount(editor);
        expect(editor.state.selection.anchor).toBe(1);
        expect(scroller().scrollTop).toBe(0);
    });

    it('does nothing outside a desktop tab', async () => {
        await leaveTab();

        const editor = newEditor();
        await mount(editor, false);
        expect(editor.state.selection.anchor).toBe(1);
        expect(scroller().scrollTop).toBe(0);
    });
});
