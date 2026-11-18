import { request, type Page } from '@playwright/test';
import { BlogConfig } from '@homebase-id/js-lib/public';
import { existsSync, readFileSync } from 'node:fs';
import { test, expect, liveIdentityOrigin, LIVE_OWNER_PASSWORD_FILE } from '../fixtures';
import { activeEditor, activeTitleInput, createNote, typeInEditor, waitForNoteSaved } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';
import { openShareDialog, shareDialog } from '../support/shareDialog';

// #1074: a note with a cropped, turned and mirrored image, published to the feed. The first
// Publish goes through the owner console's consent for the public channel, then publishes; the
// post's image payload, read logged out, holds only the edited pixels: the 16:9 crop, turned
// a quarter and mirrored, as the editor shows it. The post stays on the throwaway identity.
// #1414: after a title and body edit, Update on feed changes that post; it publishes no second one.

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

test('publishes a note with an edited image to the feed, with only the edited pixels in the post, and updates that post after an edit', async ({ liveRun }) => {
  test.setTimeout(300_000);
  const { page } = liveRun;
  const origin = liveIdentityOrigin();
  const identity = new URL(origin).hostname;
  const title = `Feed post ${Date.now()}`;
  await createNote(page, { title, body: 'A note for the feed.' });

  // Paste the picture as a JPEG file, as a screenshot paste does: a pasted <img src="data:…"> stays
  // inline and is never uploaded, so it can't be published. Then crop 16:9, rotate right and flip.
  await activeEditor(page).evaluate(async (el, svg) => {
    const img = new Image();
    img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = [img.naturalWidth, img.naturalHeight];
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    const jpeg = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95));
    const data = new DataTransfer();
    data.items.add(new File([jpeg], 'quadrants.jpg', { type: 'image/jpeg' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PICTURE);
  // Not the aria-hidden blur-up preview an uploaded image keeps under the full one: that one can't be clicked
  const img = activeEditor(page).locator('.image-node img:not([aria-hidden="true"])').first();
  await expect(img).toBeVisible();
  // Uploaded: the pending label ("Uploading…") clears once the node is promoted to an attachment
  await expect(activeEditor(page).getByTestId('pending-image-label')).toBeHidden({ timeout: 120_000 });
  await img.click();
  await page.getByRole('button', { name: 'Edit image' }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit image' });
  await editDialog.getByRole('button', { name: '16:9' }).click();
  await editDialog.getByRole('button', { name: 'Rotate right' }).click();
  await editDialog.getByRole('button', { name: 'Flip horizontal' }).click();
  await editDialog.getByRole('button', { name: 'Apply' }).click();
  await expect(editDialog).toBeHidden();
  await waitForNoteSaved(page);
  await expect(img).toBeVisible();

  // First Publish: the owner console asks for the public channel, then the reopened dialog publishes
  await openShareDialog(page, title);
  await shareDialog(page).getByRole('button', { name: 'Publish to feed' }).click();
  const published = page.getByText('Published to your feed');
  // The consent page, unless the grant is there already (a retry): then it just publishes
  await expect(async () => {
    expect(new URL(page.url()).hostname === identity || (await published.isVisible())).toBe(true);
  }).toPass({ timeout: 30_000 });
  const appOrigin = new URL(test.info().project.use.baseURL!).origin;
  await expect(async () => {
    if (new URL(page.url()).origin !== appOrigin) {
      // The console's session can have lapsed: it then asks for the password before the grant page
      const password = page.getByRole('textbox', { name: 'Password' });
      if (existsSync(LIVE_OWNER_PASSWORD_FILE) && (await password.isVisible())) {
        await password.fill(readFileSync(LIVE_OWNER_PASSWORD_FILE, 'utf8'));
      }
      await page.getByRole('button', { name: /^(Allow|Next|Login)$/ }).first().click({ timeout: 5_000 });
    }
    expect(new URL(page.url()).origin).toBe(appOrigin);
  }).toPass({ timeout: 90_000 });
  await assertTestOrigin(page);
  await expect(published).toBeVisible({ timeout: 120_000 });
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

    const media = post!.fileMetadata.payloads.find((p) => p.key.startsWith('pst_mdi'));
    if (!media) throw new Error(`no pst_mdi payload; payloads: ${JSON.stringify(post!.fileMetadata.payloads.map((p) => p.key))}`);
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

    // Edit the title and the body, then Update on feed: still one post for the note, now renamed
    await page.keyboard.press('Escape');
    await expect(shareDialog(page)).toBeHidden();
    const renamed = `${title} renamed`;
    await activeTitleInput(page).fill(renamed);
    await expect(page.getByTestId('note-row').filter({ hasText: renamed })).toBeVisible();
    await typeInEditor(page, ' Edited after publishing.');
    await openShareDialog(page, renamed);
    await shareDialog(page).getByRole('button', { name: 'Update on feed' }).click();
    await expect(page.getByText('Updated on your feed')).toBeVisible({ timeout: 120_000 });
    await expect.poll(async () => {
      const res = await anon.post(`${origin}/api/guest/v1/drive/query/batch`, {
        data: {
          queryParams: { targetDrive: drive, fileType: [BlogConfig.PostFileType] },
          resultOptionsRequest: { maxRecords: 50, includeMetadataHeader: true },
        },
      });
      const results = ((await res.json()) as { searchResults?: Result[] }).searchResults ?? [];
      const posts = results.filter((r) => r.fileMetadata.appData.content.includes(title));
      return { posts: posts.length, renamed: posts.every((r) => r.fileMetadata.appData.content.includes(renamed)) };
    }, { timeout: 60_000, message: 'one post for the note, with the new title' }).toEqual({ posts: 1, renamed: true });
  } finally {
    await anon.dispose();
  }
});
