// @vitest-environment happy-dom
/** The Share pill's "People with access": our own photo straight from our public image, and initials while a contact loads. */
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

import { AuthorImage } from '@/components/author/AuthorImage';
import { PersonLabel } from '@/components/share/SharePeopleSection';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.useContact.mockClear();
    mocks.useIsConnected.mockClear();
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe('AuthorImage', () => {
    it("loads the signed-in identity's public photo straight away, with initials until it arrives", () => {
        act(() => root.render(createElement(AuthorImage, { odinId: 'me.example.com', excludeLink: true })));

        // No contact lookup of ourselves over peer before the photo can start
        expect(mocks.useContact).not.toHaveBeenCalled();
        expect(mocks.useIsConnected).not.toHaveBeenCalled();
        const img = container.querySelector('img')!;
        expect(img.getAttribute('src')).toBe('https://me.example.com/pub/image');
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
