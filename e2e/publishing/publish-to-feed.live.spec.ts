import { request, type Page } from '@playwright/test';
import { BlogConfig } from '@homebase-id/js-lib/public';
import { test, expect, liveIdentityOrigin } from '../fixtures';
import { activeEditor, createNote, waitForNoteSaved } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { openShareDialog, shareDialog } from '../support/shareDialog';

// #1074: a note with a cropped, turned and mirrored image, published to the feed. The first
// Publish goes through the owner console's consent for the public channel, then publishes; the
// post's image payload, read logged out, holds only the edited pixels: the 16:9 crop, turned
// a quarter and mirrored, as the editor shows it. The post stays on the throwaway identity.

// 800x400, four quadrants: an asymmetric picture, so a wrong crop, turn or mirror shows.
const PICTURE = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400"><rect width="400" height="200" fill="rgb(220,40,40)"/><rect x="400" width="400" height="200" fill="rgb(40,160,40)"/><rect y="200" width="400" height="200" fill="rgb(40,40,220)"/><rect x="400" y="200" width="400" height="200" fill="rgb(220,200,40)"/></svg>`;
const COLORS = { red: [220, 40, 40], green: [40, 160, 40], blue: [40, 40, 220], yellow: [220, 200, 40] } as const;
const EXPECTED = { topLeft: 'red', topRight: 'blue', bottomLeft: 'green', bottomRight: 'yellow' };

/** Size and quadrant colours of an encoded image, decoded in the page. */
function inspect(page: Page, bytes: Buffer, type: string) {
  return page.evaluate(
    async ({ b64, type, colors }) => {
      const img = new Image();
      img.src = `data:${type};base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      [canvas.width, canvas.height] = [img.naturalWidth, img.naturalHeight];
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const at = (fx: number, fy: number) => {
        const [r, g, b] = ctx.getImageData(Math.round(canvas.width * fx), Math.round(canvas.height * fy), 1, 1).data;
        return Object.entries(colors).sort(
          ([, p], [, q]) => Math.hypot(p[0] - r, p[1] - g, p[2] - b) - Math.hypot(q[0] - r, q[1] - g, q[2] - b),
        )[0][0];
      };
      return {
        width: canvas.width,
        height: canvas.height,
        quadrants: { topLeft: at(0.25, 0.25), topRight: at(0.75, 0.25), bottomLeft: at(0.25, 0.75), bottomRight: at(0.75, 0.75) },
      };
    },
    { b64: bytes.toString('base64'), type, colors: COLORS },
  );
}

test('publishes a note with an edited image to the feed, with only the edited pixels in the post', async ({ liveRun }) => {
  test.setTimeout(300_000);
  const { page } = liveRun;
  const origin = liveIdentityOrigin();
  const identity = new URL(origin).hostname;
  const title = `Feed post ${Date.now()}`;
  await createNote(page, { title, body: 'A note for the feed.' });

  // Paste the picture, then crop 16:9, rotate right and flip horizontally
  await activeEditor(page).evaluate((el, html) => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, `<img src="data:image/svg+xml;base64,${Buffer.from(PICTURE).toString('base64')}" alt="Quadrants" width="320">`);
  const img = activeEditor(page).locator('img[alt="Quadrants"]');
  await img.click();
  await page.getByRole('button', { name: 'Edit image' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit image' });
  await editDialog.getByRole('button', { name: '16:9' }).click();
  await editDialog.getByRole('button', { name: 'Rotate right' }).click();
  await editDialog.getByRole('button', { name: 'Flip horizontal' }).click();
  await editDialog.getByRole('button', { name: 'Apply' }).click();
  await expect(editDialog).toBeHidden();
  await waitForNoteSaved(page);
  // Uploaded: the image is served from the identity, not a local blob
  await expect(activeEditor(page).locator('img[alt="Quadrants"][crossorigin]')).toBeAttached({ timeout: 120_000 });

  // First Publish: the owner console asks for the public channel, then the reopened dialog publishes
  await openShareDialog(page, title);
  await shareDialog(page).getByRole('button', { name: 'Publish to feed' }).click();
  await page.waitForURL((url) => url.hostname === identity, { timeout: 30_000 });
  const appOrigin = new URL(test.info().project.use.baseURL!).origin;
  await expect(async () => {
    if (new URL(page.url()).origin !== appOrigin) {
      await page.getByRole('button', { name: /^(Allow|Next|Login)$/ }).first().click({ timeout: 5_000 });
    }
    expect(new URL(page.url()).origin).toBe(appOrigin);
  }).toPass({ timeout: 90_000 });
  await assertTestOrigin(page);
  await expect(page.getByText('Published to your feed')).toBeVisible({ timeout: 120_000 });
  await expect(shareDialog(page).getByRole('button', { name: 'Update on feed' })).toBeVisible();

  // Logged out: find the post on the public channel and read its image payload
  const anon = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    const drive = BlogConfig.PublicChannelDrive;
    type Result = { fileId: string; fileMetadata: { appData: { content: string }; payloads: { key: string; contentType: string; lastModified: number }[] } };
    let post: Result | undefined;
    await expect.poll(async () => {
      const res = await anon.post(`${origin}/api/guest/v1/drive/query/batch`, {
        data: {
          queryParams: { targetDrive: drive, fileType: [BlogConfig.PostFileType] },
          resultOptionsRequest: { maxRecords: 50, includeMetadataHeader: true },
        },
      });
      const results = ((await res.json()) as { searchResults?: Result[] }).searchResults ?? [];
      post = results.find((r) => r.fileMetadata.appData.content.includes(title));
      return !!post;
    }, { timeout: 60_000, message: 'the post is on the public channel' }).toBe(true);

    const media = post!.fileMetadata.payloads.find((p) => p.key.startsWith('pst_mdi'))!;
    const payload = await anon.get(`${origin}/api/guest/v1/drive/files/payload`, {
      params: { alias: drive.alias, type: drive.type, fileId: post!.fileId, key: media.key, lastModified: media.lastModified },
    });
    expect(payload.status()).toBe(200);
    const type = payload.headers()['content-type'] ?? '';
    expect(type).toMatch(/^image\/jpeg/);

    // Only the edited box: 9:16, quadrants turned and mirrored
    const image = await inspect(page, await payload.body(), 'image/jpeg');
    expect(image.width / image.height).toBeCloseTo(9 / 16, 1);
    expect(image.quadrants).toEqual(EXPECTED);
  } finally {
    await anon.dispose();
  }
});
