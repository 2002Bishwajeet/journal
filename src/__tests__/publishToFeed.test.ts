// @vitest-environment happy-dom
/**
 * #1074: feed write access is asked for on the first Publish to feed, not at sign-in. Granted,
 * the publish goes on after the consent page; declined, nothing is published, the dialog says why,
 * and the next press asks again. A note published before updates its post.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createElement as h } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({
    missing: undefined as { url: string } | undefined,
    feedPostId: undefined as string | undefined,
}));
const mocks = vi.hoisted(() => ({
    saveFeedPost: vi.fn(),
    buildFeedArticle: vi.fn(),
    updateSearchIndexMetadata: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
}));

vi.mock('@/components/auth', () => ({
    useDotYouClientContext: () => ({ getHostIdentity: () => 'me.dotyou.cloud', getRoot: () => 'https://me.dotyou.cloud' }),
}));
vi.mock('@/hooks/auth/useMissingPermissions', () => ({ useMissingPermissions: () => state.missing }));
vi.mock('@/hooks/securityContext/useSecurityContext', () => ({
    useSecurityContext: () => ({ fetch: { isFetchedAfterMount: true, isFetching: false, data: {} } }),
}));
vi.mock('@/hooks/useNotes', () => ({
    useNotes: () => ({ get: { data: [{ docId: 'note-1', metadata: { title: 'Note', feedPostId: state.feedPostId } }] } }),
}));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({ syncNote: vi.fn(async () => {}) }) }));
vi.mock('@/lib/db', () => ({
    getDocumentUpdates: vi.fn(async () => []),
    getSyncRecord: vi.fn(async () => ({ remoteFileId: 'file-1' })),
    getSearchIndexEntry: vi.fn(async () => ({ title: 'Note', metadata: { title: 'Note' } })),
    updateSearchIndexMetadata: mocks.updateSearchIndexMetadata,
    updateSyncStatus: vi.fn(),
}));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/core')>()),
    getFileHeader: vi.fn(async () => null),
}));
vi.mock('@/lib/share/feedArticle', () => ({ buildFeedArticle: mocks.buildFeedArticle, saveFeedPost: mocks.saveFeedPost }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));

import { FEED_CONSENT_PENDING_KEY, FEED_PERMISSION_MESSAGE, usePublishToFeed } from '@/hooks/usePublishToFeed';

type Api = ReturnType<typeof usePublishToFeed>;
let root: ReturnType<typeof createRoot> | undefined;

async function mount() {
    const result = { current: null as Api | null };
    function Probe() {
        result.current = usePublishToFeed('note-1');
        return null;
    }
    root = createRoot(document.createElement('div'));
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    await act(async () => root!.render(h(QueryClientProvider, { client }, h(Probe))));
    return () => result.current!;
}
const unmount = async () => {
    await act(async () => root?.unmount());
    root = undefined;
};

const CONSENT_URL = 'https://me.dotyou.cloud/owner/appupdate?feed';
const assign = vi.fn();

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    state.missing = undefined;
    state.feedPostId = undefined;
    mocks.buildFeedArticle.mockResolvedValue({ content: {}, files: [] });
    mocks.saveFeedPost.mockResolvedValue('post-1');
    vi.spyOn(window.location, 'assign').mockImplementation(assign);
});
afterEach(unmount);

describe('usePublishToFeed', () => {
    it('publishes without asking when the app can already write to the feed', async () => {
        const api = await mount();
        await act(() => api().publish());

        expect(assign).not.toHaveBeenCalled();
        expect(mocks.saveFeedPost).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined);
        expect(mocks.updateSearchIndexMetadata).toHaveBeenCalledWith('note-1', 'Note', expect.objectContaining({ feedPostId: 'post-1' }));
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Published to your feed');
    });

    it('asks for feed write access on the first Publish and publishes once it is granted', async () => {
        state.missing = { url: CONSENT_URL };
        const api = await mount();
        await act(() => api().publish());

        expect(assign).toHaveBeenCalledWith(CONSENT_URL);
        expect(sessionStorage.getItem(FEED_CONSENT_PENDING_KEY)).toBe('note-1');
        expect(mocks.saveFeedPost).not.toHaveBeenCalled();

        // Back from the consent page with the grant: the reopened dialog publishes
        await unmount();
        state.missing = undefined;
        await mount();
        await act(async () => {});

        expect(mocks.saveFeedPost).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem(FEED_CONSENT_PENDING_KEY)).toBeNull();
    });

    it('leaves the note unpublished when the access is declined, says so, and asks again on the next press', async () => {
        state.missing = { url: CONSENT_URL };
        sessionStorage.setItem(FEED_CONSENT_PENDING_KEY, 'note-1');
        const api = await mount();

        expect(mocks.saveFeedPost).not.toHaveBeenCalled();
        expect(mocks.updateSearchIndexMetadata).not.toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledWith(FEED_PERMISSION_MESSAGE);
        expect(api().permissionDeclined).toBe(true);
        expect(api().isPublished).toBe(false);

        await act(() => api().publish());
        expect(assign).toHaveBeenCalledWith(CONSENT_URL);
    });

    it('updates the post published before', async () => {
        state.feedPostId = 'post-1';
        const api = await mount();
        expect(api().isPublished).toBe(true);
        await act(() => api().publish());

        expect(mocks.saveFeedPost).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'post-1');
        expect(mocks.updateSearchIndexMetadata).not.toHaveBeenCalled();
        expect(mocks.toastSuccess).toHaveBeenCalledWith('Updated on your feed');
    });

    it('keeps the note unpublished when the feed refuses the post', async () => {
        mocks.saveFeedPost.mockRejectedValue(new Error('403'));
        const api = await mount();
        await act(() => api().publish());

        expect(mocks.updateSearchIndexMetadata).not.toHaveBeenCalled();
        expect(mocks.toastError).toHaveBeenCalledWith('Failed to publish to your feed');
        expect(api().isPublishing).toBe(false);
    });
});
