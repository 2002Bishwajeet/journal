// @vitest-environment happy-dom
/**
 * "Open in app" (#1341): the journal:// mapping for the three share routes, shown in a
 * desktop browser only, with a download link when the page stays in view after the click,
 * and a remembered browser that opens share pages in the app on load.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Root } from 'react-dom/client';
import { appDeepLink, deepLinkRoute } from '@/lib/deepLink';
import { OPENS_IN_APP_KEY } from '@/hooks/useOpenInApp';
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
    // Fresh modules per test: the hook launches the app once per page load (module state).
    let React: typeof import('react');
    let OpenInJournal: typeof import('@/components/share/OpenInJournal').OpenInJournal;
    let AutoOpenedNotice: typeof import('@/components/share/OpenInJournal').AutoOpenedNotice;
    let launch: ReturnType<typeof vi.spyOn>;
    const route = `/share/alice.dotyou.cloud/${NOTE}`;
    const act = (fn: () => void | Promise<void>) => React.act(fn);

    function setUa(ua: string) {
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua });
    }
    // As the share header renders them: the button in the bar, the notice below it.
    async function mount(at = route) {
        await act(async () => {
            root.render(
                React.createElement(React.Fragment, null, React.createElement(OpenInJournal, { route: at }), React.createElement(AutoOpenedNotice, { route: at })),
            );
        });
    }
    async function click() {
        await act(async () => {
            open()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        });
    }
    const open = () => el.querySelector<HTMLAnchorElement>('a[href^="journal://"]');
    const download = () => el.querySelector<HTMLAnchorElement>(`a[href="${DOWNLOAD_URL}"]`);
    const stay = () => [...el.querySelectorAll('button')].find((b) => b.textContent === 'Stay in browser');
    const notice = () => [...el.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Opened in the Journal app'));

    beforeEach(async () => {
        vi.resetModules();
        React = await import('react');
        const { createRoot } = await import('react-dom/client');
        ({ OpenInJournal, AutoOpenedNotice } = await import('@/components/share/OpenInJournal'));
        launch = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        localStorage.clear();
        vi.useFakeTimers();
        el = document.createElement('div');
        document.body.appendChild(el);
        root = createRoot(el);
        setUa(DESKTOP_UA);
    });
    afterEach(async () => {
        await act(() => root.unmount());
        el.remove();
        delete (window as { __JOURNAL_NATIVE__?: unknown }).__JOURNAL_NATIVE__;
        vi.useRealTimers();
        vi.restoreAllMocks();
        localStorage.clear();
    });

    it('shows the button on desktop with the journal:// href', async () => {
        await mount();
        expect(open()?.getAttribute('href')).toBe(`journal://share/alice.dotyou.cloud/${NOTE}`);
        expect(open()?.textContent).toContain('Open in app');
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

    it('remembers the browser when the page loses focus within 1.5 s', async () => {
        await mount();
        await click();
        await act(async () => {
            window.dispatchEvent(new Event('blur'));
        });
        expect(localStorage.getItem(OPENS_IN_APP_KEY)).toBe('1');
    });

    it('does not remember the browser when the page stays in view', async () => {
        await mount();
        await click();
        await act(async () => {
            vi.advanceTimersByTime(1500);
        });
        await act(async () => {
            window.dispatchEvent(new Event('blur'));
        });
        expect(localStorage.getItem(OPENS_IN_APP_KEY)).toBeNull();
    });

    it('never launches the app on load without the flag', async () => {
        await mount();
        expect(launch).not.toHaveBeenCalled();
        expect(notice()).toBeUndefined();
        expect(stay()).toBeUndefined();
    });

    it('launches the app once per page load in a remembered desktop browser', async () => {
        localStorage.setItem(OPENS_IN_APP_KEY, '1');
        await mount();
        await mount();
        await act(async () => root.render(null));
        await mount();
        expect(launch).toHaveBeenCalledTimes(1);
        expect((launch.mock.contexts[0] as HTMLAnchorElement).href).toBe(`journal://share/alice.dotyou.cloud/${NOTE}`);
    });

    it('does not launch the app on load on a phone, or on the save screen', async () => {
        localStorage.setItem(OPENS_IN_APP_KEY, '1');
        await mount(`/save-shared?identity=alice.dotyou.cloud&file=${NOTE}`);
        setUa(PHONE_UA);
        await mount();
        expect(launch).not.toHaveBeenCalled();
    });

    it('shows the opened notice with Stay in browser outside the button group', async () => {
        localStorage.setItem(OPENS_IN_APP_KEY, '1');
        await mount();
        expect(notice()?.textContent).toBe('Opened in the Journal app · Stay in browser');
        expect(notice()?.contains(stay()!)).toBe(true);
        expect(el.firstElementChild?.contains(stay()!)).toBe(false);
    });

    it('Stay in browser forgets the browser and hides the line', async () => {
        localStorage.setItem(OPENS_IN_APP_KEY, '1');
        await mount();
        expect(stay()).toBeDefined();
        await act(async () => {
            stay()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(localStorage.getItem(OPENS_IN_APP_KEY)).toBeNull();
        expect(notice()).toBeUndefined();
        expect(open()).not.toBeNull();
    });

    it('does not crash or launch when storage throws', async () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('denied');
        });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('denied');
        });
        await mount();
        expect(launch).not.toHaveBeenCalled();
        await click();
        await act(async () => {
            window.dispatchEvent(new Event('blur'));
        });
        expect(open()).not.toBeNull();
    });
});
