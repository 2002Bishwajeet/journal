// @vitest-environment happy-dom
/**
 * Desktop tab keep-alive.
 *
 * Switching tabs must not unmount the note's editor: unmounting runs
 * EditorProvider's cleanups, which flush + compact the Yjs document (a full
 * rewrite in PGlite), destroy its Y.Doc and throw away undo history — and the
 * re-shown tab then has to reload from the database.
 *
 * These tests pin both halves of the policy in useMountedTabs (nothing mounts
 * before a tab is activated; an activated tab stays mounted while hidden) and
 * the React behaviour behind it: a CSS-hidden subtree keeps its effects, while
 * <Activity mode="hidden"> runs the cleanups.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createElement as h, useEffect, act, Activity } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import { useEditor, EditorContent } from '@tiptap/react';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { createCollaborationExtension } from '@/components/editor/plugins/collaboration';
import { useMountedTabs } from '@/hooks/useMountedTabs';
import type { TabInfo } from '@/hooks/useTabManager';

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const tab = (docId: string): TabInfo => ({ docId, title: docId });

/** Let teardown that React and @tiptap/react schedule asynchronously land. */
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

function mountRoot() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    return {
        root,
        cleanup: async () => {
            await act(async () => root.unmount());
            el.remove();
        },
    };
}

describe('useMountedTabs — which tabs have a mounted editor', () => {
    it('mounts nothing before a tab is activated and keeps activated tabs mounted', async () => {
        const seen: string[][] = [];
        function Policy({ tabs, activeTabId }: { tabs: TabInfo[]; activeTabId: string | null }) {
            seen.push(useMountedTabs(tabs, activeTabId).map((t) => t.docId));
            return null;
        }

        const { root, cleanup } = mountRoot();
        const render = (tabs: TabInfo[], activeTabId: string | null) =>
            act(async () => { root.render(h(Policy, { tabs, activeTabId })); });

        const all = [tab('a'), tab('b'), tab('c')];

        // Restored tabs at boot: no editor is built until one is activated.
        await render(all, null);
        expect(seen.at(-1)).toEqual([]);

        await render(all, 'a');
        expect(seen.at(-1)).toEqual(['a']);

        // Switching away keeps 'a' mounted (hidden) alongside the new tab.
        await render(all, 'b');
        expect(seen.at(-1)).toEqual(['a', 'b']);

        // Switching back mounts nothing new.
        await render(all, 'a');
        expect(seen.at(-1)).toEqual(['a', 'b']);

        // Closing 'b' drops it from openTabs — that teardown IS wanted.
        await render([tab('a'), tab('c')], 'a');
        expect(seen.at(-1)).toEqual(['a']);

        await cleanup();
    });
});

describe('hiding a mounted tab', () => {
    const ydoc = new Y.Doc();
    const extensions = [
        ...createBaseExtensions(),
        createCollaborationExtension(ydoc.getXmlFragment('prosemirror')),
    ];
    afterAll(() => ydoc.destroy());

    /** Same lifecycle shape as EditorProvider: a TipTap editor + the PGlite provider effect. */
    function Tab({ events }: { events: string[] }) {
        const editor = useEditor(
            {
                extensions,
                immediatelyRender: true,
                shouldRerenderOnTransaction: false,
                onCreate: () => events.push('editor create'),
                onDestroy: () => events.push('editor destroy'),
            },
            [extensions], // same dependency shape as EditorProvider
        );
        useEffect(() => {
            events.push('provider load');
            return () => {
                events.push('provider destroy');
            };
        }, [events]);
        return h(EditorContent, { editor });
    }

    it('keeps the same editor and provider when hidden with CSS', async () => {
        const events: string[] = [];
        const { root, cleanup } = mountRoot();
        const show = (hidden: boolean) =>
            act(async () => {
                root.render(h('div', { className: hidden ? 'hidden' : '' }, h(Tab, { events })));
            });

        await show(false);
        await settle();
        expect(events.filter((e) => e === 'editor create')).toHaveLength(1);
        expect(events.filter((e) => e === 'provider load')).toHaveLength(1);

        await show(true); // hide the tab
        await show(false); // and show it again
        await settle();

        // No teardown: no compaction, no reload, undo history intact.
        expect(events).not.toContain('editor destroy');
        expect(events).not.toContain('provider destroy');
        expect(events.filter((e) => e === 'editor create')).toHaveLength(1);
        expect(events.filter((e) => e === 'provider load')).toHaveLength(1);

        await cleanup();
    });

    it('is torn down and reloaded by <Activity mode="hidden"> — why it is not used here', async () => {
        const events: string[] = [];
        const { root, cleanup } = mountRoot();
        const show = (mode: 'visible' | 'hidden') =>
            act(async () => {
                root.render(h(Activity, { mode, children: h(Tab, { events }) }));
            });

        await show('visible');
        await show('hidden');
        await show('visible');
        await settle();

        // Activity runs effect cleanups, so hiding destroyed the provider (flush
        // + compaction rewrite) and showing rebuilt it — a second load, i.e. the
        // document re-read from the database. The editor is torn down with it,
        // but @tiptap/react schedules that asynchronously, so only the provider
        // lifecycle is asserted here.
        expect(events).toContain('provider destroy');
        expect(events.filter((e) => e === 'provider load')).toHaveLength(2);

        await cleanup();
    });
});
