import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { createNote } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #443: Share is a roomy surface. A wide two-column dialog on desktop, a
// full-screen sheet on phones, and Export lives in the note menu instead.
// Hermetic, so this is the private state (the notice and Make Note Public);
// the public state is covered by the live tier.

const DESKTOP = { width: 1280, height: 720 } as const;
const MOBILE = { width: 390, height: 844 } as const;
const THEMES = ['light', 'dark'] as const;
const SCREENSHOT_DIR = 'test-results/share-dialog-screenshots';

/** Right-clicks a note in the list, which opens its context menu. */
async function openNoteMenu(page: Page, title: string): Promise<void> {
  await page.getByRole('button').filter({ hasText: title }).first().click({ button: 'right' });
}

async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

for (const theme of THEMES) {
  test(`desktop: a wide dialog with the link preview beside the controls, ${theme} theme`, async ({ app }) => {
    await assertTestOrigin(app);
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize(DESKTOP);
    const title = `Share layout ${Date.now()}`;
    await createNote(app, { title, body: 'A note to share.' });

    await openNoteMenu(app, title);
    await expect(app.getByRole('menuitem', { name: 'Export to Markdown' })).toBeVisible();
    await app.getByRole('menuitem', { name: 'Share' }).click();

    const dialog = app.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Link preview', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Make Note Public' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Export to Markdown' })).toHaveCount(0);

    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(880);
    expect(box.height).toBeLessThanOrEqual(DESKTOP.height);

    // The preview sits to the right of the controls, at about the size chat apps render it.
    const makePublic = (await dialog.getByRole('button', { name: 'Make Note Public' }).boundingBox())!;
    const preview = (await dialog.locator('img[src="/logo.webp"]').boundingBox())!;
    expect(preview.x).toBeGreaterThan(makePublic.x + makePublic.width);
    const card = (await dialog.locator('div.rounded-lg.border').filter({ has: app.locator('img[src="/logo.webp"]') }).boundingBox())!;
    expect(card.width).toBeGreaterThanOrEqual(480);

    await shoot(app, `private-${theme}-1280`);
  });

  test(`mobile: a full-screen sheet in one column, ${theme} theme`, async ({ app }) => {
    await assertTestOrigin(app);
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize(DESKTOP);
    const title = `Share sheet ${Date.now()}`;
    await createNote(app, { title, body: 'A note to share.' });
    await app.setViewportSize(MOBILE);
    // A phone opens the note full screen; go back to the list to reach its menu.
    await app.getByRole('button', { name: 'Back', exact: true }).click();

    await openNoteMenu(app, title);
    await app.getByRole('menuitem', { name: 'Share' }).click();

    const dialog = app.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Link preview', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Export to Markdown' })).toHaveCount(0);

    // The dialog zooms in from 95%; measure only once the open animation has finished.
    await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeCloseTo(MOBILE.width, 0);
    expect(box.height).toBeCloseTo(MOBILE.height, 0);
    const overflow = await dialog.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);

    // One column: the preview is stacked above the controls, and the close button is reachable.
    const heading = (await dialog.getByText('Link preview', { exact: true }).boundingBox())!;
    const makePublic = (await dialog.getByRole('button', { name: 'Make Note Public' }).boundingBox())!;
    expect(makePublic.y).toBeGreaterThan(heading.y);
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();

    await shoot(app, `private-${theme}-390`);
  });
}
