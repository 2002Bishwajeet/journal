import type { Page } from '@playwright/test';
import { test, expect, withFencedPage, liveIdentityOrigin } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { activeEditor, createNote, shareNotePublicly } from '../support/actions';

// #390: a public share page renders mermaid, svg and html code blocks as
// previews (built from the code text), with a "View source" toggle.

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const MERMAID = 'graph TD; Start-->Finish';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><circle cx="30" cy="30" r="25" fill="tomato"/></svg>';
const HTML = '<h1 id="live-html-heading">Live html block</h1>';

const contentHtml = () =>
    [
        ['mermaid', MERMAID],
        ['svg', SVG],
        ['html', HTML],
    ]
        .map(([lang, code]) => `<pre><code class="language-${lang}">${escapeHtml(code)}</code></pre>`)
        .join('');

// Paste through the editor's real paste path (ProseMirror parses text/html).
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
    await expect(editor.locator('pre')).toHaveCount(3, { includeHidden: true });
    // Same settle wait as typeInEditor: local Yjs persistence is async.
    await page.waitForTimeout(1500);
}

test('shared note renders mermaid, svg and html blocks as previews (#390)', async ({ liveRun, browser }, testInfo) => {
    test.setTimeout(240_000);
    const { page } = liveRun;
    const title = `Live blocks note ${Date.now()}`;
    await createNote(page, { title, body: 'Live blocks, shared publicly.' });
    await pasteHtml(page, contentHtml());

    // Making a note public before its first upload finishes fails with "Note
    // with uniqueId … not found" — retry until it's there.
    let shareUrl = '';
    await expect(async () => {
        await page.keyboard.press('Escape');
        shareUrl = await shareNotePublicly(page, title);
    }).toPass({ timeout: 90_000 });

    await withFencedPage(browser, { colorScheme: 'light', viewport: { width: 1280, height: 800 } }, async (anonPage) => {
        await anonPage.goto(shareUrl);
        await assertTestOrigin(anonPage);
        const article = anonPage.getByRole('article');
        await expect(article.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 15_000 });

        await expect(article.locator('[data-live-block-preview="mermaid"] svg')).toBeVisible({ timeout: 30_000 });
        await expect(article.locator('[data-live-block-preview="svg"] img[src^="data:image/svg+xml"]')).toBeVisible();
        const frame = article.locator('[data-live-block-preview="html"] iframe');
        await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
        await expect(frame.contentFrame().locator('#live-html-heading')).toBeVisible();
        await anonPage.screenshot({ path: testInfo.outputPath('share-live-blocks-preview.png'), fullPage: true });

        // View source swaps the svg preview for the highlighted code.
        const svgBlock = article.locator('[data-live-block="svg"]');
        await svgBlock.getByRole('button', { name: 'View source' }).click();
        await expect(svgBlock.locator('pre code')).toContainText('<svg');
        await expect(svgBlock.locator('[data-live-block-preview]')).toHaveCount(0);
    }, [liveIdentityOrigin()]);
});
