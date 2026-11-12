// @vitest-environment happy-dom
/** The native bridge's schema, snapshot builder, visibility seam and purge event (#1138). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import bridgeSchema from '@/lib/native/bridgeSchema.json';

const invoke = vi.hoisted(() => vi.fn<(cmd: string, args?: unknown) => Promise<undefined>>(async () => undefined));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import {
    BRIDGE_ACTION_TYPES,
    BRIDGE_LICENSE_STATES,
    BRIDGE_RECENT_LIMIT,
    BRIDGE_SNIPPET_LENGTH,
    NO_LICENSE,
    buildBridgeSnapshot,
    checkBridgeIdentity,
    emitBridgePurge,
    getShowNotesOutsideApp,
    notesVisibleOutsideApp,
    setShowNotesOutsideApp,
    subscribeNotesVisibility,
    type BridgeAction,
    type BridgeSnapshot,
    type BridgeSnapshotState,
} from '@/lib/native/bridge';

const validator = (def: string) => z.fromJSONSchema({ ...bridgeSchema, $ref: `#/$defs/${def}` } as Parameters<typeof z.fromJSONSchema>[0]);
const snapshotSchema = validator('snapshot');
const actionSchema = validator('action');

const NOW = new Date('2026-06-10T12:00:00.000Z');

function note(i: number, text = `body ${i}`) {
    return { id: `note-${i}`, title: `Title ${i}`, text, modified: new Date(NOW.getTime() - i * 60_000).toISOString() };
}

function state(overrides: Partial<BridgeSnapshotState> = {}): BridgeSnapshotState {
    return {
        now: NOW,
        timeZone: 'Europe/Berlin',
        visible: true,
        license: { state: 'trial', trialEndsAt: '2026-06-13T12:00:00.000Z' },
        todayId: 'today-1',
        recent: [note(1), note(2)],
        ...overrides,
    };
}

const purges = () => invoke.mock.calls.filter(([cmd]) => cmd === 'plugin:journal-bridge|bridge_wipe');

beforeEach(() => {
    localStorage.clear();
    invoke.mockClear();
    window.__JOURNAL_NATIVE__ = { platform: 'ios', plugins: ['journal-bridge'] };
});

afterEach(() => {
    delete window.__JOURNAL_NATIVE__;
});

describe('bridgeSchema.json', () => {
    it('lists the same licence states and action types as the TypeScript types', () => {
        expect(bridgeSchema.$defs.license.properties.state.enum).toEqual([...BRIDGE_LICENSE_STATES]);
        expect(bridgeSchema.$defs.action.properties.type.enum).toEqual([...BRIDGE_ACTION_TYPES]);
        expect(bridgeSchema.$defs.visibleSnapshot.properties.recent.maxItems).toBe(BRIDGE_RECENT_LIMIT);
        expect(bridgeSchema.$defs.visibleSnapshot.properties.recent.items.properties.snippet.maxLength).toBe(BRIDGE_SNIPPET_LENGTH);
    });

    const visible: BridgeSnapshot = {
        schemaVersion: 1,
        updatedAt: '2026-06-10T12:00:00.000Z',
        localDate: '2026-06-10',
        timeZone: 'Europe/Berlin',
        redacted: false,
        license: { state: 'licensed', updatesUntil: '2027-06-10T00:00:00.000Z' },
        today: { id: null, title: '2026-06-10', exists: false },
        recent: [{ id: 'a', title: 'Groceries', snippet: 'Milk, eggs', modified: '2026-06-10T11:00:00.000Z' }],
    };
    const redacted: BridgeSnapshot = {
        schemaVersion: 1,
        updatedAt: '2026-06-10T12:00:00.000Z',
        localDate: '2026-06-10',
        timeZone: 'Europe/Berlin',
        redacted: true,
        license: { state: 'expired' },
        today: { id: 'b', exists: true },
        recent: [{ id: 'a', modified: '2026-06-10T11:00:00.000Z' }],
    };
    const actions: BridgeAction[] = [
        { id: '1', type: 'new_note', text: 'Idea\nmore', createdAt: '2026-06-10T11:00:00.000Z', source: 'widget' },
        { id: '2', type: 'append_today', text: 'Ran 5k', createdAt: '2026-06-10T11:01:00.000Z', source: 'watch' },
        { id: '3', type: 'open', noteId: 'a', createdAt: '2026-06-10T11:02:00.000Z', source: 'spotlight' },
    ];

    it.each([
        ['a visible snapshot', visible],
        ['a redacted snapshot', redacted],
    ])('accepts %s', (_name, fixture) => {
        expect(snapshotSchema.safeParse(fixture).success).toBe(true);
    });

    it.each(actions.map((a) => [a.type, a] as const))('accepts a %s action', (_type, fixture) => {
        expect(actionSchema.safeParse(fixture).success).toBe(true);
    });

    it.each([
        ['a title in a redacted snapshot', { ...redacted, recent: [{ id: 'a', title: 'x', modified: '2026-06-10T11:00:00.000Z' }] }],
        ["today's title in a redacted snapshot", { ...redacted, today: { id: 'b', title: '2026-06-10', exists: true } }],
        ['a redacted snapshot flagged visible', { ...redacted, redacted: false }],
        ['more than 20 recent notes', { ...visible, recent: Array.from({ length: 21 }, () => visible.recent[0]) }],
        ['a snippet longer than 120', { ...visible, recent: [{ ...visible.recent[0], snippet: 'x'.repeat(121) }] }],
        ['a local date that is not YYYY-MM-DD', { ...visible, localDate: '10/06/2026' }],
        ['another schema version', { ...visible, schemaVersion: 2 }],
        ['an unknown licence state', { ...visible, license: { state: 'pirated' } }],
    ])('rejects %s', (_name, fixture) => {
        expect(snapshotSchema.safeParse(fixture).success).toBe(false);
    });

    it.each([
        ['an unknown type', { ...actions[0], type: 'delete_all' }],
        ['a missing id', { type: 'open', noteId: 'a', createdAt: actions[0].createdAt, source: 'widget' }],
        ['an unknown field', { ...actions[0], extra: 1 }],
    ])('rejects an action with %s', (_name, fixture) => {
        expect(actionSchema.safeParse(fixture).success).toBe(false);
    });
});

describe('buildBridgeSnapshot', () => {
    it('writes a snapshot the schema accepts, visible and redacted', () => {
        expect(snapshotSchema.safeParse(buildBridgeSnapshot(state())).success).toBe(true);
        expect(snapshotSchema.safeParse(buildBridgeSnapshot(state({ visible: false }))).success).toBe(true);
    });

    it("carries the time, the licence and today's note", () => {
        const snapshot = buildBridgeSnapshot(state());
        expect(snapshot).toMatchObject({
            schemaVersion: 1,
            updatedAt: NOW.toISOString(),
            localDate: '2026-06-10',
            timeZone: 'Europe/Berlin',
            redacted: false,
            license: { state: 'trial', trialEndsAt: '2026-06-13T12:00:00.000Z' },
            today: { id: 'today-1', title: '2026-06-10', exists: true },
        });
        expect(buildBridgeSnapshot(state({ todayId: null })).today).toEqual({ id: null, title: '2026-06-10', exists: false });
    });

    it.each([
        [0, 0],
        [5, 5],
        [20, 20],
        [25, 20],
    ])('keeps %i recent notes as %i, newest first', (given, kept) => {
        const recent = Array.from({ length: given }, (_, i) => note(i));
        const snapshot = buildBridgeSnapshot(state({ recent }));
        expect(snapshot.recent.map((n) => n.id)).toEqual(recent.slice(0, kept).map((n) => n.id));
    });

    const snippetOf = (text: string) => {
        const snapshot = buildBridgeSnapshot(state({ recent: [note(1, text)] }));
        if (snapshot.redacted) throw new Error('expected a visible snapshot');
        return snapshot.recent[0].snippet;
    };

    it.each([
        ['a short text unchanged', 'Hello world', 'Hello world'],
        ['whitespace collapsed', '  Line one\n\n\tline   two  ', 'Line one line two'],
        ['exactly 120 characters unchanged', 'a'.repeat(120), 'a'.repeat(120)],
        ['121 characters cut to 120 with an ellipsis', 'a'.repeat(121), `${'a'.repeat(119)}…`],
        ['an empty text empty', '', ''],
    ])('leaves %s', (_name, text, expected) => {
        expect(snippetOf(text)).toBe(expected);
    });

    it('never cuts an emoji in half', () => {
        const snippet = snippetOf(`${'a'.repeat(118)}😀 and more`);
        expect(snippet.length).toBeLessThanOrEqual(BRIDGE_SNIPPET_LENGTH);
        expect(snippet).toBe(`${'a'.repeat(118)}…`);
    });

    it('drops every title and snippet when redacted, keeping ids', () => {
        const recent = [note(1, 'secret body one'), note(2, 'secret body two')];
        const snapshot = buildBridgeSnapshot(state({ visible: false, recent }));
        expect(snapshot.redacted).toBe(true);
        expect(snapshot.today).toEqual({ id: 'today-1', exists: true });
        expect(snapshot.recent).toEqual(recent.map(({ id, modified }) => ({ id, modified })));
        const json = JSON.stringify(snapshot);
        for (const word of ['Title', 'secret', '"title"', '"snippet"']) expect(json).not.toContain(word);
    });

    // [time zone, instant, expected local date]
    it.each([
        // Midnight in Berlin (CET, UTC+1) and New York (EST, UTC-5).
        ['Europe/Berlin', '2026-01-15T22:59:59Z', '2026-01-15'],
        ['Europe/Berlin', '2026-01-15T23:00:00Z', '2026-01-16'],
        ['America/New_York', '2026-01-16T04:59:59Z', '2026-01-15'],
        ['America/New_York', '2026-01-16T05:00:00Z', '2026-01-16'],
        // Berlin springs forward on 2026-03-29: that midnight is still UTC+1, the next is UTC+2.
        ['Europe/Berlin', '2026-03-28T22:59:59Z', '2026-03-28'],
        ['Europe/Berlin', '2026-03-28T23:00:00Z', '2026-03-29'],
        ['Europe/Berlin', '2026-03-29T21:59:59Z', '2026-03-29'],
        ['Europe/Berlin', '2026-03-29T22:00:00Z', '2026-03-30'],
        // New York falls back on 2026-11-01: that midnight is UTC-4, the next is UTC-5.
        ['America/New_York', '2026-11-01T03:59:59Z', '2026-10-31'],
        ['America/New_York', '2026-11-01T04:00:00Z', '2026-11-01'],
        ['America/New_York', '2026-11-02T04:59:59Z', '2026-11-01'],
        ['America/New_York', '2026-11-02T05:00:00Z', '2026-11-02'],
    ])('in %s at %s the local date is %s', (timeZone, instant, localDate) => {
        const now = new Date(instant);
        const snapshot = buildBridgeSnapshot(state({ now, timeZone }));
        expect(snapshot.localDate).toBe(localDate);
        expect(snapshot.timeZone).toBe(timeZone);
        if (!snapshot.redacted) expect(snapshot.today.title).toBe(localDate);
    });

    it('gives the same instant a different date in two time zones', () => {
        const now = new Date('2026-03-29T22:30:00Z');
        expect(buildBridgeSnapshot(state({ now, timeZone: 'Europe/Berlin' })).localDate).toBe('2026-03-30');
        expect(buildBridgeSnapshot(state({ now, timeZone: 'America/New_York' })).localDate).toBe('2026-03-29');
    });

    it('passes no licence on as none', () => {
        expect(buildBridgeSnapshot(state({ license: NO_LICENSE })).license).toEqual({ state: 'none' });
    });
});

describe('notesVisibleOutsideApp', () => {
    it('is true by default', () => {
        expect(getShowNotesOutsideApp()).toBe(true);
        expect(notesVisibleOutsideApp()).toBe(true);
    });

    it('follows the "Show notes outside the app" toggle and tells subscribers', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeNotesVisibility(listener);
        setShowNotesOutsideApp(false);
        expect(notesVisibleOutsideApp()).toBe(false);
        setShowNotesOutsideApp(true);
        expect(notesVisibleOutsideApp()).toBe(true);
        expect(listener).toHaveBeenCalledTimes(2);
        unsubscribe();
        setShowNotesOutsideApp(false);
        expect(listener).toHaveBeenCalledTimes(2);
    });
});

describe('bridge:purge', () => {
    it('fires once when notes turn hidden, and not again while they stay hidden', async () => {
        setShowNotesOutsideApp(false);
        setShowNotesOutsideApp(false);
        await vi.waitFor(() => expect(purges()).toHaveLength(1));
        expect(purges()[0][1]).toEqual({ reason: 'hidden' });
    });

    it('does not fire when notes stay visible or turn visible', async () => {
        setShowNotesOutsideApp(true);
        localStorage.setItem('journal-show-notes-outside-app', 'false');
        setShowNotesOutsideApp(true);
        await Promise.resolve();
        expect(purges()).toHaveLength(0);
    });

    it('fires again on the next transition to hidden', async () => {
        setShowNotesOutsideApp(false);
        setShowNotesOutsideApp(true);
        setShowNotesOutsideApp(false);
        await vi.waitFor(() => expect(purges()).toHaveLength(2));
    });

    it('fires once on an account switch, not on the first or the same identity', async () => {
        await checkBridgeIdentity('frodo.dotyou.cloud');
        await checkBridgeIdentity('frodo.dotyou.cloud');
        expect(purges()).toHaveLength(0);
        await checkBridgeIdentity('sam.dotyou.cloud');
        expect(purges()).toEqual([['plugin:journal-bridge|bridge_wipe', { reason: 'account-switch' }]]);
    });

    it('swallows a failing native purge', async () => {
        invoke.mockRejectedValueOnce(new Error('gone'));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(emitBridgePurge('sign-out')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalledWith('[bridge] Purge failed:', expect.any(Error));
        warn.mockRestore();
    });

    it('calls nothing on the web', async () => {
        delete window.__JOURNAL_NATIVE__;
        setShowNotesOutsideApp(false);
        await emitBridgePurge('sign-out');
        await checkBridgeIdentity('a');
        await checkBridgeIdentity('b');
        expect(invoke).not.toHaveBeenCalled();
    });
});
