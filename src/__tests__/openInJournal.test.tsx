// @vitest-environment happy-dom
/**
 * "Open in Journal" (#1341): the journal:// mapping for the three share routes, shown in a
 * desktop browser only, with a download link when the page stays in view after the click.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { appDeepLink, deepLinkRoute } from '@/lib/deepLink';
import { OpenInJournal } from '@/components/share/OpenInJournal';
import { DOWNLOAD_URL } from '@/lib/billing';

const NOTE = '0b9b5e3c-3f1e-4b8a-9a35-1d1f3f6c2a10';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Mobile/15E148';

describe('appDeepLink', () => {
    it.each([
        [`/share/alice.dotyou.cloud/${NOTE}`, `journal://share/alice.dotyou.cloud/${NOTE}`],
        [`/save-shared?identity=alice.dotyou.cloud&file=${NOTE}`, `journal://save-shared?identity=alice.dotyou.cloud&file=${NOTE}`],
        [`/open-shared?identity=alice.dotyou.cloud&file=${NOTE}`, `journal://open-shared?identity=alice.dotyou.cloud&file=${NOTE}`],
    ])('maps %s to %s and round-trips', (route, link) => {
        expect(appDeepLink(route)).toBe(link);
        expect(deepLinkRoute(link!)).toBe(route);
    });

    it('has no link for a route the app has no screen for', () => {
        expect(appDeepLink('/share/alice.dotyou.cloud')).toBeNull();
        expect(appDeepLink('/landing/agents')).toBeNull();
    });
});

describe('OpenInJournal', () => {
    let el: HTMLElement;
    let root: Root;
    const route = `/share/alice.dotyou.cloud/${NOTE}`;

    function setUa(ua: string) {
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua });
    }
    async function mount() {
        await act(async () => {
            root.render(createElement(OpenInJournal, { route }));
        });
    }
    async function click() {
        await act(async () => {
            open()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
    }
    const open = () => el.querySelector<HTMLAnchorElement>('a[href^="journal://"]');
    const download = () => el.querySelector<HTMLAnchorElement>(`a[href="${DOWNLOAD_URL}"]`);

    beforeEach(() => {
        vi.useFakeTimers();
        el = document.createElement('div');
        document.body.appendChild(el);
        root = createRoot(el);
        setUa(DESKTOP_UA);
    });
    afterEach(() => {
        act(() => root.unmount());
        el.remove();
        delete (window as { __JOURNAL_NATIVE__?: unknown }).__JOURNAL_NATIVE__;
        vi.useRealTimers();
    });

    it('shows the button on desktop with the journal:// href', async () => {
        await mount();
        expect(open()?.getAttribute('href')).toBe(`journal://share/alice.dotyou.cloud/${NOTE}`);
        expect(open()?.textContent).toContain('Open in Journal');
    });

    it('is hidden on a phone UA', async () => {
        setUa(PHONE_UA);
        await mount();
        expect(open()).toBeNull();
    });

    // A desktop UA in a phone-width window (and the e2e runs at 390px) keeps the phone layout.
    it('is hidden below the sm breakpoint', async () => {
        await mount();
        expect(el.firstElementChild?.classList).toContain('max-sm:hidden');
    });

    it('is hidden inside the native app', async () => {
        window.__JOURNAL_NATIVE__ = { platform: 'macos' };
        await mount();
        expect(open()).toBeNull();
    });

    it('offers the download link when the page is still in view after 1.5 s', async () => {
        await mount();
        await click();
        expect(download()).toBeNull();
        await act(async () => {
            vi.advanceTimersByTime(1500);
        });
        expect(download()?.textContent).toContain('Download Journal');
    });

    it('keeps the download link hidden when the page loses focus', async () => {
        await mount();
        await click();
        await act(async () => {
            window.dispatchEvent(new Event('blur'));
            vi.advanceTimersByTime(3000);
        });
        expect(download()).toBeNull();
    });
});
