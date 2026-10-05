import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { createNote } from '../support/actions';
import { makeSolidPng } from '../support/png';

// #448: covers are served anonymously on public notes, so the payload queued for
// upload must carry no EXIF (GPS). The cover's blob: URL wraps the very File that
// is handed to the pending-upload queue, so its bytes are the stored payload.

// Real Chromium JPEG with an EXIF APP1 segment (including a GPS IFD pointer) spliced in after SOI.
async function jpegWithGps(page: import('@playwright/test').Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#c83232';
    ctx.fillRect(0, 0, 64, 48);
    const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // TIFF header + IFD0 with one GPSInfo (0x8825) entry pointing at an empty GPS IFD.
    const tiff = [
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
      0x00, 0x01, 0x88, 0x25, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x4e, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ];
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
    const len = payload.length + 2;
    const app1 = [0xff, 0xe1, len >> 8, len & 0xff, ...payload];
    const out = new Uint8Array(bytes.length + app1.length);
    out.set(bytes.subarray(0, 2), 0);
    out.set(app1, 2);
    out.set(bytes.subarray(2), 2 + app1.length);
    let s = '';
    for (const x of out) s += String.fromCharCode(x);
    return btoa(s);
  });
  return Buffer.from(b64, 'base64');
}

// Walks JPEG segments looking for an APP1 'Exif' header.
function hasExifSegment(buf: Buffer): boolean {
  let i = 2;
  while (i + 4 < buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    if (marker === 0xda) break;
    if (marker === 0xe1 && buf.subarray(i + 4, i + 8).toString('latin1') === 'Exif') return true;
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return false;
}

async function coverBytes(page: import('@playwright/test').Page): Promise<Buffer> {
  const src = await page.getByRole('img', { name: 'Note cover' }).locator('img').first().getAttribute('src');
  expect(src).toMatch(/^blob:/);
  const arr = await page.evaluate(async (url) => Array.from(new Uint8Array(await (await fetch(url!)).arrayBuffer())), src);
  return Buffer.from(arr);
}

test('cover upload strips EXIF/GPS from the queued payload (#448)', async ({ app }) => {
  await createNote(app, { title: `Cover EXIF ${Date.now()}`, body: 'Cover below.' });

  const jpeg = await jpegWithGps(app);
  expect(hasExifSegment(jpeg)).toBe(true); // fixture sanity

  await assertTestOrigin(app);
  const chooser = app.waitForEvent('filechooser');
  await app.getByRole('button', { name: 'Add cover' }).click({ force: true });
  await (await chooser).setFiles({ name: 'gps.jpg', mimeType: 'image/jpeg', buffer: jpeg });

  await expect(app.getByRole('img', { name: 'Note cover' })).toBeVisible();
  const stored = await coverBytes(app);
  expect(stored.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
  expect(hasExifSegment(stored)).toBe(false);
  expect(stored.includes(Buffer.from('Exif'))).toBe(false);

  // A small PNG is re-encoded too (never passed through as the original bytes).
  const chooser2 = app.waitForEvent('filechooser');
  await app.getByRole('button', { name: 'Change cover' }).click({ force: true });
  await (await chooser2).setFiles({ name: 'c.png', mimeType: 'image/png', buffer: makeSolidPng(32, 32, [40, 80, 200]) });
  await expect.poll(async () => (await coverBytes(app)).includes(Buffer.from('eXIf'))).toBe(false);
});
