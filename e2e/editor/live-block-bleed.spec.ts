import { test, expect } from '../fixtures';
import { activeEditor, createNote, pastePlainText, screenshotInBothThemes } from '../support/actions';

// An html or react block's frame reaches 12px past the block on each side, with its page
// padded by as much, so an outline at the block's edge is not cut off while the content
// still lines up with the note's text.

const PARAGRAPH = 'The block below starts with a selected button at its top left corner.';
const BLOCK = [
  '<style>#first{outline:2px solid var(--foreground);outline-offset:1px}</style>',
  '<button id="first">Selected</button> <button>Other</button>',
].join('\n');

// The geometry does not depend on the theme: one run, the screenshot in both.
test("html block: an outline at the frame's edge is not cut off, and the content lines up with the text", async ({ app }) => {
  await app.setViewportSize({ width: 1280, height: 900 });
  await createNote(app, { title: `Bleed ${Date.now()}`, body: PARAGRAPH });
  await app.keyboard.press('Enter');
  await pastePlainText(app, '```html\n' + BLOCK + '\n```');

  const editor = activeEditor(app);
  const block = editor.locator('[data-live-block="html"]');
  const iframe = block.locator('iframe[title="HTML preview"]');
  const button = block.frameLocator('iframe[title="HTML preview"]').locator('#first');
  await expect(button).toBeVisible();

  const frameBox = (await iframe.boundingBox())!;
  const buttonBox = (await button.boundingBox())!;
  const paragraphBox = (await editor.getByText(PARAGRAPH).boundingBox())!;
  // The outline (1px offset + 2px wide) is inside the frame, not cut at its edge.
  expect(buttonBox.x - frameBox.x).toBeGreaterThanOrEqual(3);
  expect(buttonBox.y - frameBox.y).toBeGreaterThanOrEqual(3);
  // The button's left edge is the note text's left edge.
  expect(Math.abs(buttonBox.x - paragraphBox.x)).toBeLessThanOrEqual(1);

  await block.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await screenshotInBothThemes(
    app,
    (theme) => `bleed-outline-${theme}-1280.png`,
    () => expect(button).toBeVisible()
  );
});
