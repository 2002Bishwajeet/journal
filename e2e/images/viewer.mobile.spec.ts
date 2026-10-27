import type { CDPSession, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, activeTitleInput, inBothThemes, selectFolder, typeInEditor } from '../support/actions';
import { withMobilePage } from '../support/mobile';

// #829: on a phone an image opens a full-screen viewer (swipe down or Back closes it) and
// Edit opens a full-screen editor. The drag uses CDP touch events and the notch is a CDP
// safe-area override, so this runs in Chromium only.

const PHONE = { width: 393, height: 852 };
const TOP_INSET = 59;
const BOTTOM_INSET = 34;

async function phone(page: Page): Promise<CDPSession> {
  await page.setViewportSize(PHONE);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: TOP_INSET, bottom: BOTTOM_INSET } });
  return cdp;
}

async function shots(page: Page, what: string) {
  await inBothThemes(page, (theme) =>
    page.screenshot({ path: test.info().outputPath(`${what}-${theme}-${PHONE.width}.png`), animations: 'disabled' }),
  );
}

// One finger from `from`, moving `distance` px down, slowly enough that it is not a flick.
async function dragDown(cdp: CDPSession, page: Page, from: { x: number; y: number }, distance: number) {
  const touch = (type: string, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: from.x, y }] });
  await touch('touchStart', from.y);
  for (let step = 1; step <= 10; step++) {
    await touch('touchMove', from.y + (distance * step) / 10);
    await page.waitForTimeout(20);
  }
  // Rest before letting go, so the release has no velocity and only the distance counts.
  await page.waitForTimeout(250);
  await touch('touchEnd', from.y + distance);
}

test('a tap on the selected image opens a full-screen viewer under the notch that closes on a swipe down or Back; Edit is a full-screen editor', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'CDP touch and safe-area emulation are Chromium only');
  await withMobilePage(browser, async (page) => {
    const cdp = await phone(page);
    await selectFolder(page, 'Main');
    const before = page.url();
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    await page.waitForURL((url) => url.href !== before);
    await expect(activeTitleInput(page)).toHaveValue('Untitled');
    await activeTitleInput(page).fill(`Viewer ${Date.now()}`);
    await typeInEditor(page, 'Image below.');

    // A plain same-origin image, pasted as HTML so it skips the upload pipeline.
    await activeEditor(page).evaluate((el) => {
      const data = new DataTransfer();
      data.setData('text/html', '<img src="/pwa-512x512.png" alt="Journal logo">');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    const img = activeEditor(page).locator('img[alt="Journal logo"]');
    await expect(img).toBeVisible();
    const noteUrl = page.url();

    // The first tap selects the image (its toolbar shows); a tap on the selected image opens
    // the viewer, like iOS Notes. "View full size" in the toolbar opens it too.
    const fullSize = page.getByRole('button', { name: 'View full size' });
    const viewerDialog = page.getByRole('dialog', { name: 'Journal logo' });
    const selectedImage = activeEditor(page).locator('.ProseMirror-selectednode img[alt="Journal logo"]');
    const selectImage = async () => {
      await activeEditor(page).getByText('Image below.').tap();
      await expect(selectedImage).toHaveCount(0);
      await img.tap();
      await expect(selectedImage).toBeVisible();
      await expect(viewerDialog).toBeHidden();
    };
    const openViewer = async () => {
      await selectImage();
      await fullSize.tap();
      await expect(viewerDialog).toBeVisible();
      return viewerDialog;
    };
    await selectImage();
    await img.tap();
    const viewer = viewerDialog;
    await expect(viewer).toBeVisible();
    await expect.poll(async () => (await viewer.boundingBox())?.y).toBe(0);
    expect(await viewer.boundingBox()).toMatchObject({ x: 0, width: PHONE.width, height: PHONE.height });

    // Close and Download clear the status bar and are finger sized
    for (const name of ['Close', 'Download image']) {
      const box = (await viewer.getByRole('button', { name }).boundingBox())!;
      expect(box.width, name).toBeGreaterThanOrEqual(44);
      expect(box.height, name).toBeGreaterThanOrEqual(44);
      expect(box.y, name).toBeGreaterThanOrEqual(TOP_INSET);
    }
    await shots(page, 'viewer');

    // 40 px springs back; 200 px closes
    const zoom = viewer.getByTestId('lightbox-zoom');
    const stage = (await zoom.boundingBox())!;
    const finger = { x: PHONE.width / 2, y: stage.y + stage.height / 2 };
    const top = async () => (await zoom.boundingBox())!.y;
    const rest = await top();
    await dragDown(cdp, page, finger, 40);
    await expect.poll(top).toBe(rest);
    await expect(viewer).toBeVisible();
    await dragDown(cdp, page, finger, 200);
    await expect(viewer).toBeHidden();
    expect(page.url()).toBe(noteUrl);

    // Back closes it and the note stays open
    const again = await openViewer();
    await page.goBack();
    await expect(again).toBeHidden();
    expect(page.url()).toBe(noteUrl);
    await expect(activeTitleInput(page)).toBeVisible();

    // Edit: a full-screen editor with Cancel and Apply in its header
    await selectImage();
    await page.getByRole('button', { name: 'Edit image' }).tap();
    const editor = page.getByRole('dialog', { name: 'Edit image' });
    await expect(editor).toBeVisible();
    await expect.poll(async () => (await editor.boundingBox())?.y).toBe(0);
    expect(await editor.boundingBox()).toMatchObject({ x: 0, width: PHONE.width, height: PHONE.height });
    for (const name of ['Cancel', 'Apply', 'Rotate right', 'Flip horizontal', 'Flip vertical', 'Reset']) {
      const box = (await editor.getByRole('button', { name, exact: true }).boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(44);
      expect(box.y, name).toBeGreaterThanOrEqual(name === 'Cancel' || name === 'Apply' ? TOP_INSET : 0);
    }
    for (const corner of await editor.getByRole('button', { name: /^Crop corner/ }).all()) {
      const box = (await corner.boundingBox())!;
      expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    }
    const bottom = (await editor.getByRole('button', { name: 'Reset', exact: true }).boundingBox())!;
    expect(bottom.y + bottom.height).toBeLessThanOrEqual(PHONE.height - BOTTOM_INSET);
    await shots(page, 'editor');

    await editor.getByRole('button', { name: 'Rotate right' }).tap();
    await editor.getByRole('button', { name: 'Apply', exact: true }).tap();
    await expect(editor).toBeHidden();
    await expect(activeEditor(page).locator('.image-node[data-rotate="90"]')).toBeVisible();
    expect(page.url()).toBe(noteUrl);
  });
});
