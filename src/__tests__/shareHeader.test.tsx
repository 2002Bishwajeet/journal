// @vitest-environment happy-dom
/**
 * The share page's header and footer (#425): the logo and wordmark link home,
 * "Save a copy" only when there is a note to save, a hairline once the page
 * has scrolled, and a footer that says what Journal is.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement, act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ShareHeader } from '@/components/share/ShareHeader';
import { ShareFooter } from '@/components/share/ShareFooter';

let el: HTMLElement;
let root: Root;

async function mount(node: ReactElement): Promise<void> {
    await act(async () => {
        root.render(createElement(MemoryRouter, null, node));
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
