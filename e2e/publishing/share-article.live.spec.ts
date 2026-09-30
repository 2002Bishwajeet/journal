import type { Page, TestInfo } from '@playwright/test';
import { test, expect, withFencedPage, liveIdentityOrigin } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { activeEditor, createNote, shareNotePublicly } from '../support/actions';

// #221: the public share page reads as an article — author byline (profile
// name + avatar), no horizontal page scroll at phone width with a wide table,
// and WCAG AA contrast in dark mode. Screenshots land in SCREENSHOT_DIR, which
// the "E2E live" workflow uploads on every run.

const SCREENSHOT_DIR = 'test-results/share-article-screenshots';
const COLUMNS = 10;
const CODE = [
    '// Greets the reader of this shared note',
    "const greeting: string = 'hello';",
    'function add(a: number, b: number): number {',
    '    return a + b + 42;',
    '}',
].join('\n');

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function contentHtml(): string {
    const cells = (row: string, tag: 'th' | 'td') =>
        Array.from({ length: COLUMNS }, (_, i) => `<${tag}>${row}-column-${i + 1}-wide-value</${tag}>`).join('');
    return (
        `<pre><code class="language-ts">${escapeHtml(CODE)}</code></pre>` +
        '<table><tbody>' +
        `<tr>${cells('Heading', 'th')}</tr>` +
        `<tr>${cells('Row1', 'td')}</tr>` +
        `<tr>${cells('Row2', 'td')}</tr>` +
        '</tbody></table>' +
        '<p>Closing paragraph after the table.</p>'
    );
}

// Paste through the editor's real paste path (ProseMirror parses text/html),
// since there's no keyboard route to a 10-column table.
async function pasteHtml(page: Page, html: string): Promise<void> {
    await assertTestOrigin(page);
    const editor = activeEditor(page);
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
    await editor.evaluate((el, pasted) => {
        const data = new DataTransfer();
        data.setData('text/html', pasted);
        data.setData('text/plain', '');
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, html);
    await expect(editor.locator('table')).toBeVisible();
    await expect(editor.locator('pre')).toBeVisible();
    // Same settle wait as typeInEditor: local Yjs persistence is async.
    await page.waitForTimeout(1500);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    const path = `${SCREENSHOT_DIR}/${name}.png`;
    await page.screenshot({ path, fullPage: true });
    await testInfo.attach(name, { path, contentType: 'image/png' });
}

// Every element under `selector` that directly holds visible text, with its
// WCAG contrast ratio against its effective (alpha-composited) background.
// Colours go through a canvas so any CSS colour syntax (oklch, color-mix…) resolves to sRGB.
function contrastOf(page: Page, selector: string) {
    return page.evaluate((sel) => {
        const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
        const rgba = (css: string): [number, number, number, number] => {
            ctx.clearRect(0, 0, 1, 1);
            ctx.fillStyle = '#000';
            ctx.fillStyle = css;
            ctx.fillRect(0, 0, 1, 1);
            const d = ctx.getImageData(0, 0, 1, 1).data;
            return [d[0], d[1], d[2], d[3] / 255];
        };
        const over = (top: number[], bottom: number[]) =>
            [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1);
        const background = (el: Element | null): number[] => {
            const layers: number[][] = [];
            for (; el; el = el.parentElement) {
                const c = rgba(getComputedStyle(el).backgroundColor);
                if (c[3] === 0) continue;
                layers.push(c);
                if (c[3] === 1) break;
            }
            return layers.reduceRight((acc, layer) => over(layer, acc), [255, 255, 255, 1]);
        };
        const luminance = (c: number[]) => {
            const [r, g, b] = c.slice(0, 3).map((v) => {
                const s = v / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const results: { label: string; text: string; ratio: number }[] = [];
        for (const root of document.querySelectorAll(sel)) {
            for (const el of [root, ...root.querySelectorAll('*')]) {
                const text = [...el.childNodes]
                    .filter((n) => n.nodeType === Node.TEXT_NODE)
                    .map((n) => n.textContent ?? '')
                    .join('')
                    .trim();
                if (!text || (el as HTMLElement).offsetParent === null) continue;
                const bg = background(el);
                const fg = over(rgba(getComputedStyle(el).color), bg);
                const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
                results.push({
                    label: `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ').join('.') : ''}`,
                    text: text.slice(0, 30),
                    ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100,
                });
            }
        }
        return results;
    }, selector);
}

test('shared note reads as an article: byline, phone width, dark contrast (#221)', async ({ liveRun, browser }, testInfo) => {
    test.setTimeout(240_000);
    const { page } = liveRun;
    const identity = new URL(liveIdentityOrigin()).hostname;
    const title = `Article note ${Date.now()}`;
    await createNote(page, { title, body: 'An article with a code sample and a wide table, shared publicly.' });
    await pasteHtml(page, contentHtml());

    // Making a note public before its first upload finishes fails with "Note
    // with uniqueId … not found" (pre-existing, outside #221) — retry until it's there.
    let shareUrl = '';
    await expect(async () => {
        await page.keyboard.press('Escape');
        shareUrl = await shareNotePublicly(page, title);
    }).toPass({ timeout: 90_000 });

    const openArticle = async (anonPage: Page) => {
        await anonPage.goto(shareUrl);
        await assertTestOrigin(anonPage);
        await expect(anonPage.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 });
        const article = anonPage.getByRole('article');
        await expect(article.locator('table th')).toHaveCount(COLUMNS);
        await expect(article.locator('pre code .hljs-keyword').first()).toBeVisible();
        return article;
    };

    // Light: byline, desktop + 375px screenshots, no horizontal scroll.
    await withFencedPage(browser, { colorScheme: 'light', viewport: { width: 1280, height: 800 } }, async (anonPage) => {
        const article = await openArticle(anonPage);
        const byline = article.locator('div.not-prose').filter({ has: anonPage.locator('time') });

        // What the identity actually publishes, read the same anonymous way the page does.
        const published = await anonPage.evaluate(async (id) => {
            const profile = await fetch(`https://${id}/pub/profile`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
            const image = await fetch(`https://${id}/pub/image`).then((r) => r.status).catch(() => 0);
            return { name: (profile?.name as string | undefined) ?? '', imageStatus: image };
        }, identity);
        testInfo.annotations.push({ type: 'published profile', description: JSON.stringify(published) });
        console.log(`[share-article] ${identity} publishes ${JSON.stringify(published)}`);

        const name = byline.locator('span.font-semibold');
        await expect.soft(name).toHaveText(published.name || identity);
        await expect.soft(name).not.toHaveText('');
        await expect.soft(byline).toContainText('Published');
        await expect.soft(byline).toContainText('min read');

        const avatar = byline.locator('img');
        await expect.soft(avatar, `avatar img (identity /pub/image -> ${published.imageStatus})`).toBeVisible({ timeout: 10_000 });
        if (await avatar.count()) {
            const naturalWidth = await avatar.evaluate((img: HTMLImageElement) => img.complete ? img.naturalWidth : 0);
            expect.soft(naturalWidth, 'avatar image decoded').toBeGreaterThan(0);
        }

        await screenshot(anonPage, testInfo, 'share-article-desktop-light');

        await anonPage.setViewportSize({ width: 375, height: 812 });
        const widths = await anonPage.evaluate(() => ({
            page: document.documentElement.scrollWidth,
            viewport: window.innerWidth,
            table: document.querySelector('article table')!.scrollWidth,
        }));
        testInfo.annotations.push({ type: '375px widths', description: JSON.stringify(widths) });
        expect.soft(widths.table, 'the table is wider than the phone viewport').toBeGreaterThan(widths.viewport);
        expect.soft(widths.page, 'no horizontal page scroll at 375px').toBeLessThanOrEqual(widths.viewport);
        await screenshot(anonPage, testInfo, 'share-article-375-light');
    }, [liveIdentityOrigin()]);

    // Dark (OS setting): WCAG AA (4.5:1) for the byline, code block and table text.
    await withFencedPage(browser, { colorScheme: 'dark', viewport: { width: 1280, height: 800 } }, async (anonPage) => {
        await openArticle(anonPage);
        await expect(anonPage.locator('html')).toHaveClass(/\bdark\b/);

        for (const [area, selector] of [
            ['byline', 'article > div.not-prose'],
            ['code block', 'article pre'],
            ['table', 'article table'],
        ] as const) {
            const results = await contrastOf(anonPage, selector);
            testInfo.annotations.push({ type: `dark contrast: ${area}`, description: JSON.stringify(results) });
            expect.soft(results.length, `${area} has text to measure`).toBeGreaterThan(0);
            expect.soft(results.filter((r) => r.ratio < 4.5), `${area} text below 4.5:1 in dark mode`).toEqual([]);
        }

        await screenshot(anonPage, testInfo, 'share-article-desktop-dark');
        await anonPage.setViewportSize({ width: 375, height: 812 });
        expect.soft(await anonPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await screenshot(anonPage, testInfo, 'share-article-375-dark');
    }, [liveIdentityOrigin()]);
});
