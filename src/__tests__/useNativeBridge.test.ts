// @vitest-environment happy-dom
/** useNativeBridge (#1138): debounced snapshot writes and action drains, through invokeNative only. */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeAction, BridgeLicense, BridgeSnapshot } from '@/lib/native/bridge';

const mocks = vi.hoisted(() => ({
    invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(async () => undefined),
    importBridgeActions: vi.fn<(actions: unknown[], license: unknown) => Promise<{ ack: string[]; open: { docId: string; folderId: string } | null }>>(
        async () => ({ ack: [], open: null }),
    ),
    navigate: vi.fn(),
    liveEnabled: [] as boolean[],
    rows: [] as unknown[],
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/lib/native/bridgeImport', () => ({ importBridgeActions: mocks.importBridgeActions }));
vi.mock('@/lib/db', () => ({
    NOTE_LIST_SQL: { active: 'SELECT active' },
    getActiveNoteByTitle: vi.fn(async () => ({ docId: 'today-1', folderId: 'daily' })),
}));
vi.mock('@/hooks/useLiveQuery', () => ({
    useLiveQuery: (_sql: string, _params: unknown[], _key: string, enabled: boolean) => {
        mocks.liveEnabled.push(enabled);
        return { data: enabled ? mocks.rows : [], isLoading: false };
    },
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@homebase-id/js-lib/auth', () => ({ retrieveIdentity: () => 'frodo.dotyou.cloud' }));

import { useNativeBridge, SNAPSHOT_DEBOUNCE_MS } from '@/hooks/useNativeBridge';
import { NO_LICENSE, setShowNotesOutsideApp } from '@/lib/native/bridge';

const TRIAL: BridgeLicense = { state: 'trial' };
let license: BridgeLicense = TRIAL;
let queue: BridgeAction[] = [];

function Probe() {
    // A fresh object each render, as a licence hook may return.
    useNativeBridge({ ...license });
    return null;
}

const row = (i: number, title = `Note ${i}`) => ({
    doc_id: `note-${i}`,
    title,
    preview: `body of ${title}`,
    metadata: { timestamps: { modified: `2026-06-10T10:0${i}:00.000Z` } },
});

const calls = (command: string) => mocks.invoke.mock.calls.filter(([cmd]) => cmd === `plugin:journal-bridge|${command}`);
const snapshots = () => calls('bridge_write_snapshot').map(([, args]) => (args as { snapshot: BridgeSnapshot }).snapshot);
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
};

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('useNativeBridge', () => {
    let root: Root;
    const render = () => act(async () => root.render(h(Probe)));

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-10T12:00:00.000Z'));
        localStorage.clear();
        mocks.invoke.mockReset();
        mocks.invoke.mockImplementation(async (cmd: string) => {
            if (cmd !== 'plugin:journal-bridge|bridge_take_actions') return undefined;
            const taken = queue;
            queue = [];
            return taken;
        });
        mocks.importBridgeActions.mockClear();
        mocks.navigate.mockClear();
        mocks.liveEnabled.length = 0;
        mocks.rows = [row(1), row(2)];
        license = TRIAL;
        queue = [];
        window.__JOURNAL_NATIVE__ = { platform: 'ios', plugins: ['journal-bridge'] };
        root = createRoot(document.createElement('div'));
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        delete window.__JOURNAL_NATIVE__;
        setVisibility('visible');
        vi.useRealTimers();
    });

    it('writes one snapshot once edits settle', async () => {
        await render();
        await advance(SNAPSHOT_DEBOUNCE_MS / 2);
        mocks.rows = [row(3), row(1), row(2)];
        await render();
        await advance(SNAPSHOT_DEBOUNCE_MS / 2);
        mocks.rows = [row(4), row(3), row(1), row(2)];
        await render();
        expect(snapshots()).toHaveLength(0);

        await advance(SNAPSHOT_DEBOUNCE_MS);
        expect(snapshots()).toHaveLength(1);
        const [snapshot] = snapshots();
        expect(snapshot).toMatchObject({ redacted: false, localDate: '2026-06-10', license: { state: 'trial' }, today: { id: 'today-1', exists: true } });
        expect(snapshot.recent.map((n) => n.id)).toEqual(['note-4', 'note-3', 'note-1', 'note-2']);
    });

    it('does not rewrite on a re-render with nothing new', async () => {
        await render();
        await advance(SNAPSHOT_DEBOUNCE_MS);
        await render();
        await advance(SNAPSHOT_DEBOUNCE_MS);
        expect(snapshots()).toHaveLength(1);
    });

    it('writes a redacted snapshot when notes are hidden outside the app', async () => {
        await render();
        await advance(SNAPSHOT_DEBOUNCE_MS);
        await act(async () => setShowNotesOutsideApp(false));
        await advance(SNAPSHOT_DEBOUNCE_MS);
        expect(calls('bridge_wipe')).toEqual([['plugin:journal-bridge|bridge_wipe', { reason: 'hidden' }]]);
        const last = snapshots().at(-1)!;
        expect(last.redacted).toBe(true);
        expect(JSON.stringify(last)).not.toContain('Note 1');
    });

    it('rewrites the snapshot when the app comes back', async () => {
        await render();
        await advance(SNAPSHOT_DEBOUNCE_MS);
        await act(async () => setVisibility('visible'));
        await advance(SNAPSHOT_DEBOUNCE_MS);
        expect(snapshots()).toHaveLength(2);
    });

    it('drains on launch, acks what was imported and opens what was asked for', async () => {
        const action: BridgeAction = { id: 'a1', type: 'open', noteId: 'n1', createdAt: '2026-06-10T11:00:00.000Z', source: 'spotlight' };
        queue = [action];
        mocks.importBridgeActions.mockResolvedValueOnce({ ack: ['a1'], open: { docId: 'n1', folderId: 'f1' } });
        await render();
        await advance(0);
        expect(mocks.importBridgeActions).toHaveBeenCalledWith([action], { state: 'trial' });
        expect(calls('bridge_ack')).toEqual([['plugin:journal-bridge|bridge_ack', { ids: ['a1'] }]]);
        expect(mocks.navigate).toHaveBeenCalledWith('/f1/n1');
    });

    it('drains again when the app returns to the foreground, not on re-renders', async () => {
        await render();
        await advance(0);
        await render();
        await advance(0);
        expect(calls('bridge_take_actions')).toHaveLength(1);
        await act(async () => setVisibility('hidden'));
        expect(calls('bridge_take_actions')).toHaveLength(1);
        await act(async () => setVisibility('visible'));
        await advance(0);
        expect(calls('bridge_take_actions')).toHaveLength(2);
    });

    it('acks nothing the importer rejected', async () => {
        license = NO_LICENSE;
        queue = [{ id: 'a1', type: 'new_note', text: 'x', createdAt: '2026-06-10T11:00:00.000Z', source: 'widget' }];
        await render();
        await advance(0);
        expect(mocks.importBridgeActions).toHaveBeenCalledWith(expect.any(Array), { state: 'none' });
        expect(calls('bridge_ack')).toHaveLength(0);
        expect(mocks.navigate).not.toHaveBeenCalled();
    });

    it('does nothing on the web', async () => {
        delete window.__JOURNAL_NATIVE__;
        await render();
        await advance(SNAPSHOT_DEBOUNCE_MS * 2);
        await act(async () => setVisibility('visible'));
        await act(async () => setShowNotesOutsideApp(false));
        await advance(SNAPSHOT_DEBOUNCE_MS * 2);
        expect(mocks.invoke).not.toHaveBeenCalled();
        expect(mocks.importBridgeActions).not.toHaveBeenCalled();
        expect(mocks.liveEnabled.every((enabled) => !enabled)).toBe(true);
    });

    it('does nothing in a native app without the bridge plugin', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'android', plugins: [] };
        await render();
        await advance(SNAPSHOT_DEBOUNCE_MS * 2);
        expect(mocks.invoke).not.toHaveBeenCalled();
    });
});
