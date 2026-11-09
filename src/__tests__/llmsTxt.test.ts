/**
 * public/llms.txt is served at https://journal.cloudx.run/llms.txt, next to the landing site's
 * generated /landing/llms.txt (site/llms.txt). It follows llmstxt.org (an H1, then a blockquote
 * summary, then sections of links), and it links to every page the landing site's index does,
 * so a page added there fails here until the root file follows.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const ROOT = read('public/llms.txt');
const links = (text: string) => [...text.matchAll(/\]\(([^)]+)\)/g)].map(([, url]) => url);

describe('public/llms.txt', () => {
    it('starts with an H1 and a blockquote summary', () => {
        const [title, , summary] = ROOT.split('\n');
        expect(title).toBe('# Journal');
        expect(summary).toMatch(/^> \S/);
    });

    it('has only absolute links', () => {
        expect(links(ROOT).length).toBeGreaterThan(0);
        for (const url of links(ROOT)) expect(url).toMatch(/^https:\/\//);
    });

    it("links to every page in the landing site's llms.txt", () => {
        const site = read('site/llms.txt').replaceAll('{{SITE}}', 'https://journal.cloudx.run');
        expect(links(ROOT)).toEqual(expect.arrayContaining(links(site)));
    });

    it('is allowed in robots.txt', () => {
        expect(read('public/robots.txt')).toContain('Allow: /llms.txt\n');
    });
});
