// @vitest-environment happy-dom
/** #682: adding people and circles in the Share dialog, by keyboard, and saving the full set. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
    share: vi.fn(async () => ({ shared: true })),
    revoke: vi.fn(async () => true),
    notes: [] as unknown[],
}));

vi.mock('@homebase-id/js-lib/network', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/network')>()),
    fetchMembersOfCircle: async (_client: unknown, id: string) =>
        (id === 'c1' ? [{ domain: 'a.id' }, { domain: 'b.id' }] : []),
}));
vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => ({ getHostIdentity: () => 'me.id' }) }));
vi.mock('@/hooks/circles/useCircles', () => ({
    useCircles: () => ({ fetch: { data: [{ id: 'c1', name: 'Friends' }, { id: 'c2', name: 'Empty friends' }], isLoading: false } }),
}));
vi.mock('@/hooks/usePeerPushSubscriptions', () => ({ getAllConnectionIds: async () => new Set(['sam.id', 'frodo.id']) }));
vi.mock('@/hooks/useNotes', () => ({ useNotes: () => ({ get: { data: mocks.notes } }) }));
vi.mock('@/hooks/useNoteCollaboration', () => ({ useNoteCollaboration: () => ({ share: mocks.share, revoke: mocks.revoke }) }));
vi.mock('@/hooks/usePersonSharingSupported', () => ({ usePersonSharingSupported: () => true }));
vi.mock('@/hooks/useContact', () => ({ useContact: () => ({ fetch: { data: undefined } }) }));
vi.mock('@/components/author/AuthorImage', () => ({ AuthorImage: () => null }));

import { useShareAccess, type ShareAccess } from '@/hooks/useShareAccess';
import { SharePeopleSection } from '@/components/share/SharePeopleSection';

const latestRef: { current?: ShareAccess } = {};
function Harness() {
    const access = useShareAccess('n1', true);
    useEffect(() => { latestRef.current = access; });
    return createElement(SharePeopleSection, { access });
}

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const field = () => document.querySelector<HTMLInputElement>('#share-search')!;
const options = () => [...document.querySelectorAll('[role="option"]')];

async function type(text: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), text);
        field().dispatchEvent(new Event('input', { bubbles: true }));
    });
}
async function press(key: string) {
    await act(async () => { field().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
}
async function choose(label: string, value: string) {
    const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

describe('SharePeopleSection', () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.notes = [];
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(Harness))); });
        await flush();
    });

    afterEach(async () => {
        await act(async () => { root.unmount(); });
        host.remove();
    });

    it('adds a circle as an editor and a connection as a viewer with Enter, then saves the full set', async () => {
        await type('friends');
        expect(options().map((o) => o.textContent)).toEqual(['Empty friendsNo members', 'Friends2 members']);
        // The first result that can be added is highlighted
        expect(options()[1].getAttribute('aria-selected')).toBe('true');
        expect(document.querySelector<HTMLSelectElement>('select[aria-label="Role for people and circles you add"]')?.value).toBe('editor');
        await press('Enter');

        await type('sam');
        expect(document.querySelector<HTMLSelectElement>('select[aria-label="Role for people and circles you add"]')?.value).toBe('viewer');
        await press('Enter');

        expect(document.querySelector<HTMLSelectElement>('select[aria-label="Role for Friends"]')?.value).toBe('editor');
        expect(document.querySelector<HTMLSelectElement>('select[aria-label="Role for sam.id"]')?.value).toBe('viewer');
        await act(async () => { await latestRef.current!.save(); });
        expect(mocks.share).toHaveBeenCalledWith('n1', {
            circles: [{ circleId: 'c1', name: 'Friends' }],
            viewerCircles: [],
            odinIds: ['sam.id'],
        });
    });

    it('moves the highlight with the arrow keys and cannot add a circle with no members', async () => {
        await type('friends');
        await press('ArrowDown');
        expect(options()[0].getAttribute('aria-selected')).toBe('true');
        expect(field().getAttribute('aria-activedescendant')).toBe(options()[0].id);
        await press('Enter');

        expect(latestRef.current!.entries).toEqual([]);
        expect(options()).toHaveLength(2);
    });

    it('adds a circle as viewers when the role picker says so', async () => {
        await type('friends');
        await choose('Role for people and circles you add', 'viewer');
        await press('Enter');
        await act(async () => { await latestRef.current!.save(); });

        expect(mocks.share).toHaveBeenCalledWith('n1', expect.objectContaining({
            circles: [],
            viewerCircles: [{ circleId: 'c1', name: 'Friends' }],
        }));
    });

    it("refuses a typed identity that isn't a connection", async () => {
        await type('stranger.example.com');

        expect(options()).toHaveLength(0);
        expect(document.querySelector('[role="alert"]')?.textContent).toBe("Only people you're connected with can be added.");
        await press('Enter');
        expect(latestRef.current!.entries).toEqual([]);
    });
});

describe('SharePeopleSection on a shared note', () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.notes = [{
            docId: 'n1',
            title: 'N',
            metadata: { isCollaborative: true, circleIds: ['c1'], odinIds: ['sam.id'], folderId: 'f1' },
        }];
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        await act(async () => { root.render(createElement(QueryClientProvider, { client }, createElement(Harness))); });
        await flush();
    });

    afterEach(async () => {
        await act(async () => { root.unmount(); });
        host.remove();
    });

    it('starts from who the note is shared with, and saves nothing until something changes', async () => {
        expect(document.querySelector('ul[aria-label="People with access"]')?.textContent).toContain('Owner');
        expect(document.querySelector<HTMLSelectElement>('select[aria-label="Role for Friends"]')?.value).toBe('editor');
        expect(latestRef.current!.isDirty).toBe(false);

        await act(async () => { await latestRef.current!.save(); });
        expect(mocks.share).not.toHaveBeenCalled();
    });

    it('changes a circle to viewers and removes one person', async () => {
        await choose('Role for Friends', 'viewer');
        await choose('Role for sam.id', 'remove');
        expect(document.querySelector('select[aria-label="Role for sam.id"]')).toBeNull();

        await act(async () => { await latestRef.current!.save(); });
        expect(mocks.share).toHaveBeenCalledWith('n1', {
            circles: [],
            viewerCircles: [{ circleId: 'c1', name: 'Friends' }],
            odinIds: [],
        });
    });

    it('stops sharing when everyone is removed', async () => {
        await choose('Role for Friends', 'remove');
        await choose('Role for sam.id', 'remove');
        await act(async () => { await latestRef.current!.save(); });

        expect(mocks.share).not.toHaveBeenCalled();
        expect(mocks.revoke).toHaveBeenCalledWith(mocks.notes[0]);
    });
});
