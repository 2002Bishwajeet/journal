import { test, expect } from '../fixtures';
import { activeEditor, pastePlainText } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #945: the app's enforced frame-src must leave a block's srcdoc frame alone, and the bridge
// must work over its port, in every engine. mobile-webkit is the one run of this in Safari's.

const SOURCE = [
  '<div id="out" style="height: 300px">loading</div>',
  '<script>',
  "journal.storage.set('count', 3).then(() => journal.storage.get('count')).then((count) => { document.getElementById('out').textContent = 'count: ' + count; });",
  '</script>',
].join('\n');

test('html block: on a phone it runs in its frame and reaches the app', async ({ browser }) => {
  await withMobilePage(browser, async (page) => {
    await page.getByRole('navigation', { name: 'Folders' }).getByRole('button', { name: 'Main' }).tap();
    await page.getByRole('button', { name: 'New note', exact: true }).tap();
    await activeEditor(page).tap();
    await pastePlainText(page, '```html\n' + SOURCE + '\n```');

    const block = activeEditor(page).locator('[data-live-block="html"]');
    await expect(block.frameLocator('iframe[title="HTML preview"]').locator('#out')).toHaveText('count: 3');
    await expect(block.locator('[data-live-block-preview="html"]')).toHaveCSS('height', '300px');
  });
});
