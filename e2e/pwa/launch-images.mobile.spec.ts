import { test, expect } from '@playwright/test';

// #854: iOS shows a launch image from <link rel="apple-touch-startup-image">
// matched by media query. Each one must load as a PNG whose pixel size is the
// device size times the pixel ratio the media query names.

const MEDIA = /\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d+)\) and \(orientation: (portrait|landscape)\)(?: and \(prefers-color-scheme: (light|dark)\))?/;

test('every launch image loads as a PNG that matches its media query', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const tags = [...html.matchAll(/<link\b[^>]*rel="apple-touch-startup-image"[^>]*>/g)].map((m) => m[0]);
  expect(tags.length).toBeGreaterThan(0);

  const schemes = new Set<string>();
  let hasIphone15Portrait = false;

  for (const tag of tags) {
    const media = /media="([^"]+)"/.exec(tag)?.[1] ?? '';
    const href = /href="([^"]+)"/.exec(tag)?.[1] ?? '';
    const m = MEDIA.exec(media);
    expect(m, `media of ${href}`).not.toBeNull();
    const [, w, h, dpr, orientation, scheme] = m!;
    if (scheme) schemes.add(scheme);

    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
    expect(res.headers()['content-type'], href).toContain('image/png');

    // PNG IHDR: width at byte 16, height at byte 20 (big-endian).
    const body = await res.body();
    const width = body.readUInt32BE(16);
    const height = body.readUInt32BE(20);
    const [cssW, cssH] = orientation === 'portrait' ? [+w, +h] : [+h, +w];
    expect([width, height], href).toEqual([cssW * +dpr, cssH * +dpr]);

    if (w === '393' && h === '852' && dpr === '3' && orientation === 'portrait') hasIphone15Portrait = true;
  }

  expect([...schemes].sort()).toEqual(['dark', 'light']);
  expect(hasIphone15Portrait).toBe(true);
});
