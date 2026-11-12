// @vitest-environment happy-dom
/** #1117: the macOS Dock menu's recent notes, sent to the premium plugin (mocked). */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { invoke } = vi.hoisted(() => ({
    invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(async () => undefined),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { useDockMenu } from '@/hooks/useDockMenu';
import { useRecordRecentNote } from '@/hooks/useRecentNotes';
import { emitBridgePurge, setShowNotesOutsideApp } from '@/lib/native/bridge';
import { clearDockMenu, DOCK_RECENT_LIMIT, dockMenuNotes, setDockMenu } from '@/lib/native/dockMenu';
import type { RecentNote } from '@/lib/recentItems';
import type { NativePlatform } from '@/lib/native';

const PLUGIN = 'journal-dock-menu';
const SET = `plugin:${PLUGIN}|dock_menu_set`;

interface Row {
    docId: string;
    title: string;
    metadata: { archivalStatus?: number };
}

const row = (i: number, archivalStatus = 0): Row => ({ docId: `note-${i}`, title: `Title ${i}`, metadata: { archivalStatus } });
const opened = (...ids: number[]): RecentNote[] => ids.map((i, n) => ({ docId: `note-${i}`, openedAt: 1000 - n }));

const setNative = (platform: NativePlatform, plugins: string[] = [PLUGIN]) => {
    window.__JOURNAL_NATIVE__ = { platform, plugins };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const sent = () => invoke.mock.calls.filter(([cmd]) => cmd === SET).map(([, args]) => args);
const lastSent = () => sent().at(-1);

function Probe({ noteId, notes }: { noteId: string | null; notes: Row[] }) {
    useRecordRecentNote(noteId);
    useDockMenu(noteId, notes);
    return null;
}

let root: Root;

async function render(noteId: string | null, notes: Row[]) {
    await act(async () => root.render(h(Probe, { noteId, notes })));
    await flush();
}

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
    localStorage.clear();
    setNative('macos');
    // Start each test from an empty menu, so no "already sent" list carries over.
    await clearDockMenu();
    invoke.mockClear();
    root = createRoot(document.createElement('div'));
});

afterEach(() => {
    act(() => root.unmount());
    delete window.__JOURNAL_NATIVE__;
});

describe('dockMenuNotes', () => {
    const notes = Array.from({ length: 8 }, (_, i) => row(i));

    it('should list the opened notes newest first, ids and titles only', () => {
        expect(dockMenuNotes(opened(2, 0), notes)).toEqual([
            { id: 'note-2', title: 'Title 2' },
            { id: 'note-0', title: 'Title 0' },
        ]);
    });

    it(`should cap the list at ${DOCK_RECENT_LIMIT}`, () => {
        const list = dockMenuNotes(opened(0, 1, 2, 3, 4, 5, 6, 7), notes);
        expect(list.map((n) => n.id)).toEqual(['note-0', 'note-1', 'note-2', 'note-3', 'note-4']);
    });

    it('should list a note once', () => {
        expect(dockMenuNotes(opened(1, 1, 2, 1), notes).map((n) => n.id)).toEqual(['note-1', 'note-2']);
    });

    it('should skip missing, archived and trashed notes', () => {
        const list = dockMenuNotes(opened(9, 1, 2, 3), [row(1, 1), row(2), row(3, 2)]);
        expect(list).toEqual([{ id: 'note-2', title: 'Title 2' }]);
    });
});

describe('useDockMenu', () => {
    const notes = Array.from({ length: 8 }, (_, i) => row(i));

    it('should send the note just opened, first', async () => {
        await render('note-1', notes);
        await render('note-2', notes);
        expect(lastSent()).toEqual({
            notes: [
                { id: 'note-2', title: 'Title 2' },
                { id: 'note-1', title: 'Title 1' },
            ],
        });
    });

    it(`should send at most ${DOCK_RECENT_LIMIT} notes, each once`, async () => {
        for (const i of [0, 1, 2, 3, 4, 5, 6, 2]) await render(`note-${i}`, notes);
        expect(lastSent()).toEqual({
            notes: [2, 6, 5, 4, 3].map((i) => ({ id: `note-${i}`, title: `Title ${i}` })),
        });
    });

    it('should send a renamed title, and nothing when the list is unchanged', async () => {
        await render('note-1', notes);
        await render('note-1', [...notes]);
        expect(sent()).toHaveLength(1);
        await render('note-1', [{ ...row(1), title: 'Trip notes' }]);
        expect(lastSent()).toEqual({ notes: [{ id: 'note-1', title: 'Trip notes' }] });
    });

    it('should send no titles while notes are hidden outside the app', async () => {
        setShowNotesOutsideApp(false);
        await render('note-1', notes);
        expect(sent()).toEqual([{ notes: [] }]);
        expect(JSON.stringify(invoke.mock.calls)).not.toContain('Title 1');
    });

    it('should drop the titles as soon as notes are hidden outside the app', async () => {
        await render('note-1', notes);
        invoke.mockClear();
        await act(async () => setShowNotesOutsideApp(false));
        await flush();
        expect(sent()).toEqual([{ notes: [] }]);
    });

    it.each([
        ['the web', () => delete window.__JOURNAL_NATIVE__],
        ['the public build (no plugin)', () => setNative('macos', [])],
        ['Windows', () => setNative('windows')],
    ])('should call nothing on %s', async (_name, platform) => {
        platform();
        await render('note-1', notes);
        expect(invoke).not.toHaveBeenCalled();
    });
});

describe('bridge:purge', () => {
    it.each(['hidden', 'sign-out', 'account-switch'] as const)('should clear the recent notes on %s', async (reason) => {
        await setDockMenu([{ id: 'note-1', title: 'Title 1' }]);
        invoke.mockClear();
        await emitBridgePurge(reason);
        expect(sent()).toEqual([{ notes: [] }]);
    });

    it('should send the list again after a purge', async () => {
        await setDockMenu([{ id: 'note-1', title: 'Title 1' }]);
        await emitBridgePurge('sign-out');
        invoke.mockClear();
        await setDockMenu([{ id: 'note-1', title: 'Title 1' }]);
        expect(sent()).toEqual([{ notes: [{ id: 'note-1', title: 'Title 1' }] }]);
    });

    it('should not throw when the plugin fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        invoke.mockRejectedValueOnce(new Error('gone'));
        await expect(setDockMenu([{ id: 'note-1', title: 'Title 1' }])).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledOnce();
        warn.mockRestore();
    });
});
