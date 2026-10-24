/**
 * #744: the service worker shows Journal's web pushes (and only Journal's), and a click on
 * one opens the shared note.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { JOURNAL_APP_ID } from '@/lib/homebase/config';

vi.mock('workbox-precaching', () => ({
    precacheAndRoute: vi.fn(),
    cleanupOutdatedCaches: vi.fn(),
    createHandlerBoundToURL: vi.fn(() => () => new Response('shell')),
}));

vi.mock('workbox-routing', async (importOriginal) => ({
    ...(await importOriginal<typeof import('workbox-routing')>()),
    registerRoute: vi.fn(),
}));

type Listener = (event: unknown) => void;
const listeners: Record<string, Listener> = {};
const showNotification = vi.fn(async () => {});
const matchAll = vi.fn();
const openWindow = vi.fn(async () => null);

beforeAll(async () => {
    vi.stubGlobal('self', {
        __WB_MANIFEST: [],
        addEventListener: (type: string, listener: Listener) => { listeners[type] = listener; },
        registration: { showNotification },
        clients: { matchAll, openWindow },
    });
    await import('@/sw');
});

beforeEach(() => {
    showNotification.mockClear();
    openWindow.mockClear();
    matchAll.mockReset();
});

function payload(appId: string, tagId: string, senderId = 'sam.dotyou.cloud') {
    return { senderId, appDisplayName: 'Journal', timestamp: 1, options: { appId, typeId: 'type-1', tagId, unEncryptedMessage: 'shared a note' } };
}

async function firePush(data: unknown) {
    let done: Promise<unknown> = Promise.resolve();
    listeners.push({ data: { json: () => data }, waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
}

async function fireClick(data: unknown) {
    const close = vi.fn();
    let done: Promise<unknown> = Promise.resolve();
    listeners.notificationclick({ notification: { close, data }, waitUntil: (p: Promise<unknown>) => { done = p; } });
    await done;
    return close;
}

describe('sw push', () => {
    it('shows a notification for a Journal payload and tells open windows', async () => {
        const client = { postMessage: vi.fn() };
        matchAll.mockResolvedValue([client]);
        const p = payload(JOURNAL_APP_ID, 'note-1');
        await firePush({ payloads: [p] });

        expect(showNotification).toHaveBeenCalledWith('sam.dotyou.cloud', {
            body: 'shared a note',
            tag: 'note-1',
            data: { senderId: 'sam.dotyou.cloud', typeId: 'type-1', tagId: 'note-1' },
        });
        expect(client.postMessage).toHaveBeenCalledWith({ type: 'journal-push', payload: p });
    });

    it('matches the app id when the server sends the GUID with dashes', async () => {
        matchAll.mockResolvedValue([]);
        const dashed = JOURNAL_APP_ID.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
        await firePush({ payloads: [payload(dashed, 'note-1')] });
        expect(showNotification).toHaveBeenCalledTimes(1);
    });

    it("shows nothing for another app's payload", async () => {
        const client = { postMessage: vi.fn() };
        matchAll.mockResolvedValue([client]);
        await firePush({ payloads: [payload('00000000000000000000000000000001', 'chat-1')] });
        expect(showNotification).not.toHaveBeenCalled();
        expect(client.postMessage).not.toHaveBeenCalled();
    });

    it('shows one notification per Journal payload in a push with several', async () => {
        matchAll.mockResolvedValue([]);
        await firePush({
            payloads: [
                payload(JOURNAL_APP_ID, 'note-1'),
                payload('00000000000000000000000000000001', 'chat-1'),
                payload(JOURNAL_APP_ID, 'note-2', 'pippin.dotyou.cloud'),
            ],
        });
        expect(showNotification).toHaveBeenCalledTimes(2);
        expect(showNotification).toHaveBeenCalledWith('pippin.dotyou.cloud', expect.objectContaining({ tag: 'note-2' }));
    });
});

describe('sw notificationclick', () => {
    const data = { senderId: 'sam.dotyou.cloud', typeId: 'type-1', tagId: 'note-1' };
    const url = '/shared/note-1?from=sam.dotyou.cloud';

    it('focuses an open window and navigates it to the note', async () => {
        const client = { focus: vi.fn(async () => {}), navigate: vi.fn(async () => null) };
        matchAll.mockResolvedValue([client]);
        const close = await fireClick(data);
        expect(close).toHaveBeenCalled();
        expect(client.focus).toHaveBeenCalled();
        expect(client.navigate).toHaveBeenCalledWith(url);
        expect(openWindow).not.toHaveBeenCalled();
    });

    it('opens a window on the note when none is open', async () => {
        matchAll.mockResolvedValue([]);
        const close = await fireClick(data);
        expect(close).toHaveBeenCalled();
        expect(openWindow).toHaveBeenCalledWith(url);
    });
});
