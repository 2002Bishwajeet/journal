import { test, expect } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';

// #434: every shared note's link card is a designed 1200×630 JPEG drawn in the app.
// This renders the card for short and long titles, with and without a cover, saves
// each as a screenshot, and checks it isn't blank and no text runs into the margins.
// The card is one light template (crawlers have no theme), so it's shot in light only.

const CARD = { width: 1200, height: 630 } as const;
const LONG_TITLE =
  'A remarkably long title for a shared note that keeps going well past three lines of serif text, so the card has to cut it short with an ellipsis instead of overflowing';
const EXCERPT =
  'The first paragraph of the note, which is long enough to wrap onto a second line and then some more, so the excerpt is cut with an ellipsis too.';

const CASES = [
  { name: 'cover-short', title: 'Morning pages', cover: true },
  { name: 'cover-long', title: LONG_TITLE, cover: true },
  { name: 'no-cover-short', title: 'Morning pages', cover: false },
  { name: 'no-cover-long', title: LONG_TITLE, cover: false },
] as const;

for (const c of CASES) {
  test(`renders the ${c.name} card, not blank and not clipped`, async ({ app }) => {
    await assertTestOrigin(app);
    await app.emulateMedia({ colorScheme: 'light' });
    await app.setViewportSize(CARD);

    const result = await app.evaluate(async ({ title, withCover, excerpt }) => {
      let cover: { image: Blob; positionY: number } | undefined;
      if (withCover) {
        // A flat mid-grey cover: the scrim keeps each row uniform, so any text in a margin shows.
        const canvas = new OffscreenCanvas(1600, 900);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#7a8a99';
        ctx.fillRect(0, 0, 1600, 900);
        cover = { image: await canvas.convertToBlob({ type: 'image/png' }), positionY: 50 };
      }
      const card = await window.__journalE2E!.renderCard(
        { title, excerpt: withCover ? undefined : excerpt, author: 'Ada Lovelace' },
        cover,
      );

      const bitmap = await createImageBitmap(card);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      const lum = (x: number, y: number) => {
        const i = (y * bitmap.width + x) * 4;
        return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      };
      // The largest spread of brightness along any row of a region: ~0 when it holds no text.
      const rowSpread = (x0: number, x1: number, y0: number, y1: number) => {
        let worst = 0;
        for (let y = y0; y < y1; y++) {
          let min = 255;
          let max = 0;
          for (let x = x0; x < x1; x++) {
            const l = lum(x, y);
            min = Math.min(min, l);
            max = Math.max(max, l);
          }
          worst = Math.max(worst, max - min);
        }
        return worst;
      };

      const img = document.createElement('img');
      img.src = URL.createObjectURL(card);
      img.style.cssText = 'position:fixed;inset:0;width:1200px;height:630px;z-index:2147483647';
      document.body.append(img);
      await img.decode();

      return {
        type: card.type,
        width: bitmap.width,
        height: bitmap.height,
        content: rowSpread(80, 1120, 80, 550),
        margins: {
          top: rowSpread(0, 1200, 0, 40),
          bottom: rowSpread(0, 1200, 595, 630),
          left: rowSpread(0, 50, 0, 630),
          right: rowSpread(1150, 1200, 0, 630),
        },
        fontsLoaded: document.fonts.check('600 64px "Playfair Display Variable"'),
      };
    }, { title: c.title, withCover: c.cover, excerpt: EXCERPT });

    await app.screenshot({ path: test.info().outputPath(`card-${c.name}-light-1200.png`) });

    expect(result.type).toBe('image/jpeg');
    expect({ width: result.width, height: result.height }).toEqual(CARD);
    expect(result.fontsLoaded).toBe(true);
    // Not blank: the title is drawn in strong contrast against the card.
    expect(result.content).toBeGreaterThan(150);
    // Not clipped: nothing but background in the margins (JPEG noise aside).
    for (const [side, spread] of Object.entries(result.margins)) {
      expect(spread, `${side} margin`).toBeLessThan(24);
    }
  });
}
