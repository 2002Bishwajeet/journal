// @vitest-environment happy-dom
/**
 * The share page's header and footer (#425): the logo and wordmark link home,
 * "Save a copy" only when there is a note to save, a hairline once the page
 * has scrolled, and a footer that says what Journal is.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ShareHeader } from '@/components/share/ShareHeader';
import { ShareFooter } from '@/components/share/ShareFooter';

let el: HTMLElement;
let root: Root;

async function mount(node: ReactElement, initialEntries = ['/']): Promise<void> {
    await act(async () => {
        root.render(createElement(MemoryRouter, { initialEntries }, node));
    });
}

const links = () => [...el.querySelectorAll('a')];
const link = (name: string) => links().find((a) => a.textContent?.trim() === name);

async function scrollTo(y: number): Promise<void> {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
    await act(async () => {
        window.dispatchEvent(new Event('scroll'));
    });
}

beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
});

afterEach(async () => {
    await act(async () => root.unmount());
    el.remove();
    await scrollTo(0);
});

describe('ShareHeader', () => {
    it('links the logo and wordmark home', async () => {
        await mount(createElement(ShareHeader));
        const home = link('Journal')!;
        expect(home.getAttribute('href')).toBe('/');
        expect(home.querySelector('img')?.getAttribute('src')).toBe('/logo.webp');
    });

    it('shows "Save a copy" with its route, and "Open Journal"', async () => {
        await mount(createElement(ShareHeader, { saveHref: '/save-shared?identity=a.test&file=1' }));
        expect(link('Save a copy')?.getAttribute('href')).toBe('/save-shared?identity=a.test&file=1');
        expect(link('Open Journal')?.getAttribute('href')).toBe('/');
    });

    it('leaves "Save a copy" out without a note to save', async () => {
        await mount(createElement(ShareHeader));
        expect(link('Save a copy')).toBeUndefined();
        expect(link('Open Journal')).toBeDefined();
    });

    it('links to the author index with a plain link, only when given one (#515)', async () => {
        await mount(createElement(ShareHeader, { authorIndexHref: '/share/author.test' }));
        const index = link('More notes')!;
        expect(index.getAttribute('href')).toBe('/share/author.test');
        expect(index.hasAttribute('data-discover')).toBe(false); // not a router <Link>
        await mount(createElement(ShareHeader));
        expect(link('More notes')).toBeUndefined();
    });

    it('offers "Download PDF" only when given a way to print (#520)', async () => {
        const onDownloadPdf = vi.fn();
        await mount(createElement(ShareHeader, { onDownloadPdf }));
        const button = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Download PDF')!;
        await act(async () => button.click());
        expect(onDownloadPdf).toHaveBeenCalledOnce();
        await mount(createElement(ShareHeader));
        expect(el.textContent).not.toContain('Download PDF');
    });

    it('shows its hairline only once the page has scrolled', async () => {
        await mount(createElement(ShareHeader));
        const header = el.querySelector('header')!;
        expect(header.dataset.scrolled).toBe('false');
        await scrollTo(120);
        expect(header.dataset.scrolled).toBe('true');
        expect(header.className).toContain('border-border');
        await scrollTo(0);
        expect(header.dataset.scrolled).toBe('false');
        expect(header.className).toContain('border-transparent');
    });

    // #1341: after an automatic launch, "Stay in browser" sits in a line below the bar, not in it.
    it('puts the opened notice below the bar, not in it', async () => {
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130' });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        localStorage.setItem('journal-opens-in-app', '1');
        await mount(createElement(ShareHeader), ['/share/a.test/0b9b5e3c-3f1e-4b8a-9a35-1d1f3f6c2a10']);
        const header = el.querySelector('header')!;
        const notice = header.nextElementSibling!;
        expect(notice.textContent).toBe('Opened in the Journal app · Stay in browser');
        expect(header.textContent).not.toContain('Stay in browser');
        expect(header.querySelector('a[href^="journal://"]')?.textContent).toContain('Open in app');
        localStorage.clear();
        vi.restoreAllMocks();
    });
});

describe('ShareFooter', () => {
    it('shows the logo, what Journal is, a way in and whose content it is', async () => {
        await mount(createElement(ShareFooter, { identity: 'author.test' }));
        const footer = el.querySelector('footer')!;
        expect(footer.querySelector('img')?.getAttribute('src')).toBe('/logo.webp');
        expect(footer.textContent).toContain('private notes you own, stored on your Homebase identity');
        expect(link('Start your journal')?.getAttribute('href')).toBe('/');
        expect(footer.textContent).toContain("Published by author.test. Content is the author's own and is not reviewed by Journal.");
    });
});
