import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, pastePlainText, reloadNote, screenshotInBothThemes, waitForNoteSaved } from '../support/actions';

// #673: KaTeX and the highlight.js grammars load only when a note has math or code.
// Each was on every note open before, prose or not.

// Strings only KaTeX's JS, a grammar (lowlight's common set) or KaTeX's CSS contains.
const HEAVY_MARKERS = ['katex-display', 'php-template', '.katex{'];

/** The heavy markers found in the JS and CSS the page has loaded so far, by file. */
async function heavyAssetsLoaded(page: Page): Promise<string[]> {
  return page.evaluate(async (markers) => {
    const urls = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => /\/assets\/[^?#]+\.(?:js|css)(?:[?#]|$)/.test(url));
    const found: string[] = [];
    for (const url of new Set(urls)) {
      const text = await (await fetch(url)).text();
      for (const marker of markers) if (text.includes(marker)) found.push(`${new URL(url).pathname}: ${marker}`);
    }
    return found;
  }, HEAVY_MARKERS);
}

/** Every sample over `ms` of whether an edit is waiting to be saved. */
async function unsavedSamples(page: Page, ms = 1_000): Promise<boolean[]> {
  return page.evaluate(async (duration) => {
    const samples: boolean[] = [];
    for (const end = Date.now() + duration; Date.now() < end; ) {
      samples.push(await window.__journalE2E!.hasUnsavedEdits());
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return samples;
  }, ms);
}

const CODE = 'const answer: number = 42;';
const INLINE = 'E = mc^2';
const BLOCK = '\\int_0^1 x\\,dx';
const INVALID = '\\badmacro{';

test('a note with only prose loads neither KaTeX nor the code grammars', async ({ app }) => {
  await createNote(app, { title: `Prose only ${Date.now()}`, body: 'Just a paragraph of prose, no code and no math.' });
  await reloadNote(app);
  await expect(activeEditor(app)).toContainText('Just a paragraph of prose');
  await app.waitForLoadState('networkidle');

  expect(await heavyAssetsLoaded(app)).toEqual([]);
});

test('code and math load on demand, then highlight and typeset after a reload without a save', async ({ app }) => {
  await createNote(app, { title: `Code and math ${Date.now()}`, body: 'Intro' });
  expect(await heavyAssetsLoaded(app)).toEqual([]);
  const editor = activeEditor(app);

  // Inserted into a prose note: the grammars and KaTeX load then.
  await app.keyboard.press('Enter');
  await pastePlainText(app, `\`\`\`ts\n${CODE}\n\`\`\``);
  await expect(editor.locator('pre .hljs-keyword').first()).toHaveText('const');
  // After the code block: inline math, block math and invalid inline math, typed through their input rules.
  // The block goes last: typing right after it can land on the block's node selection and replace it.
  const inline = editor.locator('[data-type="inline-math"]');
  const block = editor.locator('[data-type="block-math"]');
  await app.keyboard.press('ControlOrMeta+End');
  await app.keyboard.type(`Energy is $$${INLINE}$$ `);
  await expect(inline).toHaveCount(1);
  await app.keyboard.press('Enter');
  await app.keyboard.type(`Broken $$${INVALID}$$ `);
  await expect(inline).toHaveCount(2);
  await app.keyboard.press('Enter');
  await app.keyboard.type(`$$$${BLOCK}$$$`);
  await expect(block).toHaveCount(1);
  const expectRendered = async () => {
    await expect(editor.locator('pre .hljs-keyword').first()).toHaveText('const');
    await expect(inline.first().locator('.katex')).toBeVisible();
    await expect(block.locator('.katex')).toBeVisible();
    // Invalid LaTeX keeps its raw text.
    await expect(inline.nth(1)).toHaveText(INVALID);
    await expect(inline.nth(1).locator('.katex')).toHaveCount(0);
  };
  await expectRendered();
  await waitForNoteSaved(app);

  await reloadNote(app);
  await expectRendered();
  // KaTeX's stylesheet came with it.
  expect(await inline.first().locator('.katex').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('KaTeX_Main');
  // Drawing the highlights changed nothing in the note: nothing to save.
  expect(await unsavedSamples(app)).not.toContain(true);

  await screenshotInBothThemes(app, (theme) => `editor-code-math-${theme}.png`, async () => {
    await expectRendered();
  });
});
