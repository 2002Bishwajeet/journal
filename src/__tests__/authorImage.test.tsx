// @vitest-environment happy-dom
/** The sidebar and the Share pill's "People with access": our own photo from our public image through the service worker's proxy (fetched into a blob: URL without one), and initials while a contact loads. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
    useContact: vi.fn(() => ({ fetch: { data: undefined, isLoading: true } })),
    useIsConnected: vi.fn(() => ({ data: null })),
}));

vi.mock('@/components/auth', () => ({ useDotYouClientContext: () => ({ getHostIdentity: () => 'me.example.com' }) }));
vi.mock('@/hooks/useContact', () => ({ useContact: mocks.useContact }));
vi.mock('@/hooks/connections/useIsConnected', () => ({ useIsConnected: mocks.useIsConnected }));

import { AuthorImage, OwnerImage } from '@/components/author/AuthorImage';
import { PersonLabel } from '@/components/share/SharePeopleSection';

const PHOTO = 'https://me.example.com/pub/image';
const PROXIED_PHOTO = `/proxy-image/${encodeURIComponent(PHOTO)}`;
const BLOB_PHOTO = 'blob:photo';

let container: HTMLDivElement;
let root: Root;
let serviceWorker: EventTarget & { controller: object | null };
const fetchMock = vi.fn();

beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(new Blob(['jpeg'], { type: 'image/jpeg' })));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue(BLOB_PHOTO);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    serviceWorker = Object.assign(new EventTarget(), { controller: {} });
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.useContact.mockClear();
    mocks.useIsConnected.mockClear();
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('OwnerImage', () => {
    it("shows the host identity's initials and public photo, not the app host's", () => {
        expect(window.location.hostname).not.toBe('me.example.com');
        act(() => root.render(createElement(OwnerImage, { size: 'xs' })));

        expect(container.textContent).toBe('ME');
        expect(container.querySelector('img')!.getAttribute('src')).toBe(PROXIED_PHOTO);
    });

    it('fits the initials to the circle instead of the 40px fallback default', () => {
        act(() => root.render(createElement(OwnerImage, { size: 'custom', className: 'size-9' })));

        const fallback = container.firstElementChild!.firstElementChild!;
        expect(fallback.className).toContain('size-full');
        expect(fallback.className).not.toContain('h-10');
    });

    it('fetches the photo into a blob: URL while no service worker controls the page, then uses the proxy', async () => {
        serviceWorker.controller = null;
        await act(async () => root.render(createElement(OwnerImage, { size: 'xs' })));

        expect(fetchMock).toHaveBeenCalledWith(PHOTO);
        expect(container.querySelector('img')!.getAttribute('src')).toBe(BLOB_PHOTO);
        expect(container.textContent).toBe('ME');

        serviceWorker.controller = {};
        act(() => serviceWorker.dispatchEvent(new Event('controllerchange')));
        expect(container.querySelector('img')!.getAttribute('src')).toBe(PROXIED_PHOTO);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith(BLOB_PHOTO);
    });

    it('fetches the photo where service workers are unavailable (the iOS app)', async () => {
        delete (navigator as { serviceWorker?: unknown }).serviceWorker;
        await act(async () => root.render(createElement(OwnerImage, { size: 'xs' })));

        expect(fetchMock).toHaveBeenCalledWith(PHOTO);
        const img = container.querySelector('img')!;
        expect(img.getAttribute('src')).toBe(BLOB_PHOTO);

        act(() => img.dispatchEvent(new Event('load')));
        expect(container.textContent).toBe('');
    });

    it('keeps initials when the fetched photo is missing', async () => {
        delete (navigator as { serviceWorker?: unknown }).serviceWorker;
        fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
        await act(async () => root.render(createElement(OwnerImage, { size: 'xs' })));

        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toBe('ME');
    });

    it('does not fetch when a service worker controls the page', () => {
        act(() => root.render(createElement(OwnerImage, { size: 'xs' })));

        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('AuthorImage', () => {
    it('falls back to the owner when no identity is given', () => {
        act(() => root.render(createElement(AuthorImage, {})));

        expect(mocks.useContact).not.toHaveBeenCalled();
        expect(container.querySelector('img')!.getAttribute('src')).toBe(PROXIED_PHOTO);
    });

    it("loads the signed-in identity's public photo straight away, with initials until it arrives", () => {
        act(() => root.render(createElement(AuthorImage, { odinId: 'me.example.com', excludeLink: true })));

        // No contact lookup of ourselves over peer before the photo can start
        expect(mocks.useContact).not.toHaveBeenCalled();
        expect(mocks.useIsConnected).not.toHaveBeenCalled();
        const img = container.querySelector('img')!;
        expect(img.getAttribute('src')).toBe(PROXIED_PHOTO);
        expect(img.className).toBe('hidden');
        expect(container.textContent).toBe('ME');

        act(() => img.dispatchEvent(new Event('load')));
        expect(container.textContent).toBe('');
        expect(img.className).not.toBe('hidden');
    });

    it('keeps our initials when the public photo fails', () => {
        act(() => root.render(createElement(AuthorImage, { odinId: 'me.example.com', excludeLink: true })));
        act(() => container.querySelector('img')!.dispatchEvent(new Event('error')));

        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toBe('ME');
    });

    it("shows someone else's initials, not a spinner, while their contact loads", () => {
        act(() => root.render(createElement(AuthorImage, { odinId: 'sam.example.com', excludeLink: true })));

        expect(mocks.useContact).toHaveBeenCalled();
        expect(container.querySelector('svg')).toBeNull();
        expect(container.textContent).toBe('SE');
    });
});

describe('PersonLabel', () => {
    it('shows our identity without a contact lookup of ourselves', () => {
        act(() => root.render(createElement(PersonLabel, { odinId: 'me.example.com' })));

        expect(mocks.useContact).toHaveBeenCalledWith(expect.objectContaining({ odinId: undefined }));
        expect(container.textContent).toBe('me.example.com');
    });

    it("looks up someone else's name in their contact", () => {
        act(() => root.render(createElement(PersonLabel, { odinId: 'sam.example.com' })));

        expect(mocks.useContact).toHaveBeenCalledWith(expect.objectContaining({ odinId: 'sam.example.com' }));
    });
});
