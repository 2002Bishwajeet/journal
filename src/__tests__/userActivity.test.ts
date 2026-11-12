// @vitest-environment happy-dom
/** #1147: the macOS app advertises the open note for Handoff through the premium plugin (mocked). */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { invoke } = vi.hoisted(() => ({
    invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(async () => undefined),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { useUserActivity } from '@/hooks/useUserActivity';
import { setShowNotesOutsideApp } from '@/lib/native/bridge';
import { clearUserActivity, setUserActivity } from '@/lib/native/userActivity';
import type { NativePlatform } from '@/lib/native';

const PLUGIN = 'journal-user-activity';
const SET = `plugin:${PLUGIN}|user_activity_set`;
const CLEAR = `plugin:${PLUGIN}|user_activity_clear`;
const A = '0f8fad5b-d9cb-469f-a165-70867728950e';
const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const setNative = (platform: NativePlatform, plugins: string[] = [PLUGIN]) => {
    window.__JOURNAL_NATIVE__ = { platform, plugins };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const calls = () => invoke.mock.calls.map(([cmd, args]) => [cmd, args]);

function Probe({ noteId, title }: { noteId: string | null; title?: string }) {
    useUserActivity(noteId, title);
    return null;
}

let root: Root;
let container: HTMLElement;

async function render(noteId: string | null, title?: string) {
    await act(async () => root.render(h(Probe, { noteId, title })));
    await flush();
}

beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    invoke.mockClear();
    localStorage.clear();
    setNative('macos');
    container = document.createElement('div');
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    delete window.__JOURNAL_NATIVE__;
});

describe('useUserActivity', () => {
    it('should advertise the open note with its title', async () => {
        await render(A, 'Trip notes');
        expect(calls()).toEqual([[SET, { noteId: A, title: 'Trip notes' }]]);
    });

    it('should replace the activity when the title changes, without clearing it', async () => {
        await render(A, 'Trip');
        await render(A, 'Trip notes');
        expect(calls()).toEqual([
            [SET, { noteId: A, title: 'Trip' }],
            [SET, { noteId: A, title: 'Trip notes' }],
        ]);
    });

    it('should send no title while notes are hidden outside the app', async () => {
        setShowNotesOutsideApp(false);
        await render(A, 'Diagnosis');
        expect(calls()).toEqual([[SET, { noteId: A, title: undefined }]]);
    });

    it('should drop the title as soon as notes are hidden outside the app', async () => {
        await render(A, 'Diagnosis');
        invoke.mockClear();
        await act(async () => setShowNotesOutsideApp(false));
        await flush();
        expect(calls()).toContainEqual([SET, { noteId: A, title: undefined }]);
        expect(calls()).not.toContainEqual([SET, { noteId: A, title: 'Diagnosis' }]);
    });

    it('should clear the old note before advertising the next one', async () => {
        await render(A, 'First');
        await render(B, 'Second');
        expect(calls()).toEqual([
            [SET, { noteId: A, title: 'First' }],
            [CLEAR, undefined],
            [SET, { noteId: B, title: 'Second' }],
        ]);
    });

    it('should clear the activity when the note closes and when the app shell goes away', async () => {
        await render(A, 'First');
        await render(null);
        expect(calls().at(-1)).toEqual([CLEAR, undefined]);

        await render(B, 'Second');
        invoke.mockClear();
        act(() => root.unmount());
        await flush();
        expect(calls()).toEqual([[CLEAR, undefined]]);
        root = createRoot(container);
    });

    it('should advertise nothing when no note is open', async () => {
        await render(null);
        expect(invoke).not.toHaveBeenCalled();
    });

    it.each([
        ['the web', () => delete window.__JOURNAL_NATIVE__],
        ['the public build (no plugin)', () => setNative('macos', [])],
        ['Windows', () => setNative('windows')],
    ])('should call nothing on %s', async (_name, platform) => {
        platform();
        await render(A, 'Trip notes');
        await render(null);
        expect(invoke).not.toHaveBeenCalled();
    });
});

describe('setUserActivity and clearUserActivity', () => {
    it('should not throw when the plugin fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        invoke.mockRejectedValueOnce(new Error('not a note id')).mockRejectedValueOnce(new Error('gone'));
        await expect(setUserActivity('nope')).resolves.toBeUndefined();
        await expect(clearUserActivity()).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });
});
