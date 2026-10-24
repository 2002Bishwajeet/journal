/**
 * #744: the service worker shows Journal's web pushes, and a click on one opens the shared
 * note. Other apps' pushes reach this subscription too and get a generic notification, so
 * Chrome never shows its "updated in the background" notice.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { COLLABORATIVE_FOLDER_ID, JOURNAL_APP_ID, JOURNAL_PUSH_TYPE_EDIT } from '@/lib/homebase/config';

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

    it("shows a generic notification for another app's payload and does not tell open windows", async () => {
        const client = { postMessage: vi.fn() };
        matchAll.mockResolvedValue([client]);
        await firePush({ payloads: [{ ...payload('2d781401-3804-4b57-b4aa-d8e4e2ef39f4', 'chat-1'), appDisplayName: 'Chat' }] });
        expect(showNotification).toHaveBeenCalledWith('Chat', { body: 'sam.dotyou.cloud sent you a notification via Chat', tag: 'chat-1' });
        expect(client.postMessage).not.toHaveBeenCalled();
    });

    it('shows one notification per payload in a push with several', async () => {
        matchAll.mockResolvedValue([]);
        await firePush({
            payloads: [
                payload(JOURNAL_APP_ID, 'note-1'),
                payload('00000000000000000000000000000001', 'chat-1'),
                payload(JOURNAL_APP_ID, 'note-2', 'pippin.dotyou.cloud'),
            ],
        });
        expect(showNotification).toHaveBeenCalledTimes(3);
        expect(showNotification).toHaveBeenCalledWith('pippin.dotyou.cloud', expect.objectContaining({ tag: 'note-2' }));
    });

    it('still shows a notification for a push it cannot read', async () => {
        matchAll.mockResolvedValue([]);
        let done: Promise<unknown> = Promise.resolve();
        listeners.push({ data: { json: () => { throw new SyntaxError('bad'); } }, waitUntil: (p: Promise<unknown>) => { done = p; } });
        await done;
        expect(showNotification).toHaveBeenCalledWith('Homebase', { body: 'You have a new notification' });
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

    it('opens the owner note at its collaborative-folder route for an edit push (#746)', async () => {
        const client = { focus: vi.fn(async () => {}), navigate: vi.fn(async () => null) };
        matchAll.mockResolvedValue([client]);
        await fireClick({ senderId: 'sam.dotyou.cloud', typeId: JOURNAL_PUSH_TYPE_EDIT, tagId: 'note-1' });
        expect(client.navigate).toHaveBeenCalledWith(`/${COLLABORATIVE_FOLDER_ID}/note-1`);
    });

    it("focuses Journal without navigating for another app's notification", async () => {
        const client = { focus: vi.fn(async () => {}), navigate: vi.fn(async () => null) };
        matchAll.mockResolvedValue([client]);
        await fireClick(undefined);
        expect(client.focus).toHaveBeenCalled();
        expect(client.navigate).not.toHaveBeenCalled();

        matchAll.mockResolvedValue([]);
        await fireClick(undefined);
        expect(openWindow).toHaveBeenCalledWith('/');
    });
});
