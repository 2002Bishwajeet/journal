import type { FrameLocator, Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { activeEditor, createNote, pastePlainText } from '../support/actions';

// #559: a react block keeps Journal's look by default, and goes further when it asks:
// real shadows, arbitrary values, `md:` in a `wide` block (#557), and
// Tailwind's own palette under `palette-raw`.

// A block written by the default guidance: theme names and mapped palette classes, all in the fixed sheet.
const DEFAULT_BLOCK = [
  'function App() {',
  '  return (',
  '    <div id="card" className="space-y-2 rounded-lg border bg-card p-4">',
  '      <p className="text-lg font-semibold">Writing this week</p>',
  '      <p id="caption" className="text-sm text-gray-500">Words per day</p>',
  '      <button id="like" className="rounded-md bg-blue-500 px-3 py-1 text-sm text-white">Like</button>',
  '    </div>',
  '  );',
  '}',
].join('\n');

// A bold block: Tailwind's own palette, a real shadow, arbitrary values and md: columns.
const BOLD_BLOCK = [
  'function App() {',
  '  return (',
  '    <div id="root-box" className="palette-raw space-y-3 p-4">',
  '      <div id="poster" className="w-[420px] rounded-xl bg-[#ff6600] p-[18px] text-[13px] text-white shadow-xl">Launch</div>',
  '      <div id="cols" className="grid grid-cols-[1fr_2fr] gap-2 md:grid-cols-3">',
  '        <span id="blue" className="bg-blue-500 p-2 text-white">One</span>',
  '        <span className="bg-emerald-500 p-2 text-white">Two</span>',
  '        <span className="bg-amber-400 p-2">Three</span>',
  '      </div>',
  '    </div>',
  '  );',
  '}',
].join('\n');

const reactBlock = (page: Page): Locator => activeEditor(page).locator('[data-live-block="react"]').first();
const reactFrame = (page: Page): FrameLocator => reactBlock(page).frameLocator('iframe[title="React preview"]');

/** Pastes `source` as a react block on a new line; a pasted block opens in Preview. */
async function pasteBlock(page: Page, source: string, info = 'react'): Promise<void> {
  await page.keyboard.press('Enter');
  await pastePlainText(page, '```' + info + '\n' + source + '\n```');
}

/** The widths of the bold block's grid columns, in px. */
const columns = (frame: FrameLocator) =>
  frame.locator('#cols').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').map((width) => Math.round(parseFloat(width))));

/** Screenshots `block`, once its frame has painted. */
async function shoot(block: Locator, name: string): Promise<void> {
  await block.scrollIntoViewIfNeeded();
  await block.frameLocator('iframe').locator('body').evaluate(() => new Promise<void>((painted) => requestAnimationFrame(() => requestAnimationFrame(() => painted()))));
  await block.screenshot({ path: test.info().outputPath(name) });
}

/** A colour as the frame computes it. */
function computedColour(frame: FrameLocator, colour: string): Promise<string> {
  return frame.locator('body').evaluate((body, value) => {
    const probe = body.appendChild(document.createElement('i'));
    probe.style.color = value;
    const computed = getComputedStyle(probe).color;
    probe.remove();
    return computed;
  }, colour);
}

for (const theme of ['light', 'dark'] as const) {
  test(`react block styling: a block written by the default guidance gets only the fixed sheet, as before, ${theme} theme`, async ({ app }) => {
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize({ width: 1280, height: 900 });
    await createNote(app, { title: `React styling ${theme} ${Date.now()}`, body: 'Intro' });
    await expect(app.locator('html')).toHaveClass(new RegExp(theme));

    // Before: a block that follows the default guidance gets only the fixed sheet, as before #559.
    await pasteBlock(app, DEFAULT_BLOCK);
    const plain = reactFrame(app);
    await expect(plain.getByRole('button', { name: 'Like' })).toBeVisible();
    await expect(plain.locator('style')).toHaveCount(2); // buildSrcdoc's theme style and the fixed sheet
    await expect(plain.locator('#journal-block-tailwind')).toHaveCount(0);
    const defaultLook = await plain.locator('#card').evaluate((card) => {
      const like = getComputedStyle(document.getElementById('like')!);
      const probe = document.body.appendChild(document.createElement('i'));
      probe.style.color = 'var(--chart-5)';
      const chart5 = getComputedStyle(probe).color;
      probe.remove();
      return { like: like.backgroundColor, chart5, shadow: getComputedStyle(card).boxShadow };
    });
    expect(defaultLook.like).toBe(defaultLook.chart5);
    expect(defaultLook.shadow).toBe('none');
    await shoot(reactBlock(app), `react-default-before-${theme}-1280.png`);
  });

  test(`react block styling: a block that asks gets real shadows, arbitrary values, and palette-raw, ${theme} theme`, async ({ app }) => {
    await app.emulateMedia({ colorScheme: theme });
    await app.setViewportSize({ width: 1280, height: 900 });
    await createNote(app, { title: `React styling bold ${theme} ${Date.now()}`, body: 'Intro' });
    await expect(app.locator('html')).toHaveClass(new RegExp(theme));

    // After: the bold block draws the exact colours and sizes it asks for.
    await pasteBlock(app, BOLD_BLOCK);
    const bold = reactFrame(app);
    await expect(bold.locator('#poster')).toBeVisible();
    await expect(bold.locator('#journal-block-tailwind')).toHaveCount(1);
    const poster = await bold.locator('#poster').evaluate((el) => {
      const style = getComputedStyle(el);
      return { background: style.backgroundColor, color: style.color, fontSize: style.fontSize, width: style.width, padding: style.paddingTop, shadow: style.boxShadow };
    });
    expect(poster.background).toBe('rgb(255, 102, 0)');
    expect(poster.color).toBe(await computedColour(bold, '#fff'));
    expect(poster.fontSize).toBe('13px');
    expect(poster.width).toBe('420px');
    expect(poster.padding).toBe('18px');
    // shadow-xl, Tailwind's own, softer in the dark theme (after Tailwind's empty ring and inset layers).
    const alpha = theme === 'dark' ? 0.06 : 0.1;
    expect(poster.shadow.endsWith(`, rgba(0, 0, 0, ${alpha}) 0px 20px 25px -5px, rgba(0, 0, 0, ${alpha}) 0px 8px 10px -6px`), poster.shadow).toBe(true);
    // palette-raw: bg-blue-500 is Tailwind's real blue, not the theme's --chart-5.
    expect(await bold.locator('#blue').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await computedColour(bold, 'oklch(62.3% 0.214 259.815)'));

    // In the note column (about 650px) md: does not apply: the arbitrary 1fr 2fr columns hold.
    const narrow = await columns(bold);
    expect(narrow).toHaveLength(2);
    expect(Math.abs(narrow[1] - 2 * narrow[0])).toBeLessThanOrEqual(2);
    await shoot(reactBlock(app), `react-bold-normal-${theme}-1280.png`);
  });

  test(`react block styling: md: applies in a wide block, ${theme} theme`, async ({ app }) => {
    await app.emulateMedia({ colorScheme: theme });
    // md: is 768px of frame: with the sidebar and the note list open, a wide block is that wide on a 1600px window.
    await app.setViewportSize({ width: 1600, height: 900 });
    await createNote(app, { title: `React styling wide ${theme} ${Date.now()}`, body: 'Intro' });
    await expect(app.locator('html')).toHaveClass(new RegExp(theme));

    await pasteBlock(app, BOLD_BLOCK, 'react wide');
    await expect(reactBlock(app)).toHaveAttribute('data-live-block-wide', '');
    const wide = reactFrame(app);
    await expect(wide.locator('#poster')).toBeVisible();
    const cols = await columns(wide);
    expect(cols).toHaveLength(3);
    expect(Math.max(...cols) - Math.min(...cols)).toBeLessThanOrEqual(1);
    await shoot(reactBlock(app), `react-bold-wide-${theme}-1600.png`);
  });
}
