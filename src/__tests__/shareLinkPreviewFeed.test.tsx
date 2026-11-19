// @vitest-environment happy-dom
/** #1416: on the feed, the Link preview is the feed post's card with its link; otherwise unchanged. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ identity: 'alice.dotyou.cloud' }));

vi.mock('@/hooks/auth', () => ({ useAuth: () => ({ getIdentity: () => mocks.identity }) }));
vi.mock('@/hooks/useNotes', () => ({ useNotes: () => ({}) }));
vi.mock('@/hooks/useSyncService', () => ({ useSyncService: () => ({}) }));
vi.mock('@/hooks/useShareCardPreview', () => ({
    useShareCardPreview: () => ({ description: 'Card description', cardImageFrom: undefined }),
}));
vi.mock('@/hooks/useShareCardImage', () => ({ useShareCardImage: () => undefined }));
vi.mock('@/components/share/ShareCardPreview', () => ({
    ShareCardPreview: ({ domain, description }: { domain: string; description: string }) =>
        createElement('div', { 'data-testid': 'card' }, `${domain}|${description}`),
}));

import { ShareLinkPreview } from '@/components/share/ShareGeneralAccess';

let root: Root;
let host: HTMLElement;
beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.identity = 'alice.dotyou.cloud';
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

function render(props: { feedPostId?: string; feedSummary?: string }) {
    act(() => root.render(createElement(ShareLinkPreview, { noteId: 'n1', noteTitle: 'T', isPublic: true, ...props })));
}
const card = () => host.querySelector('[data-testid="card"]')!.textContent;
const postLink = () => host.querySelector<HTMLInputElement>('input[aria-label="Feed post link"]');

describe('ShareLinkPreview on the feed', () => {
    it('without a feedPostId keeps the journal card and shows no post link', () => {
        render({});
        expect(card()).not.toContain('alice.dotyou.cloud');
        expect(card()).toContain('|Card description');
        expect(postLink()).toBeNull();
    });

    it('with a feedPostId shows the identity domain, the summary and the post link', () => {
        render({ feedPostId: 'abc-1', feedSummary: 'Feed summary' });
        expect(card()).toBe('alice.dotyou.cloud|Feed summary');
        expect(postLink()!.value).toBe('https://alice.dotyou.cloud/posts/public-posts/abc-1');
    });

    it('falls back to the card description when the summary is blank', () => {
        render({ feedPostId: 'abc-1', feedSummary: '  ' });
        expect(card()).toBe('alice.dotyou.cloud|Card description');
    });

    it('encodes special characters in the post id', () => {
        render({ feedPostId: 'a b/c' });
        expect(postLink()!.value).toBe('https://alice.dotyou.cloud/posts/public-posts/a%20b%2Fc');
    });

    it('shows no post link without an identity', () => {
        mocks.identity = '';
        render({ feedPostId: 'abc-1' });
        expect(postLink()).toBeNull();
        expect(card()).not.toContain('unknown');
    });
});
