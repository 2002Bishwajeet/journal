import { expect, type Locator } from '@playwright/test';

/** Height of a cell's content (its box minus padding) in px. */
const contentHeight = (cell: Locator) =>
  cell.evaluate((el) => {
    const style = getComputedStyle(el);
    return el.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  });

/**
 * How many lines of text a cell holds: its content height over the content height of
 * a one-line header cell of the same table (a header holds one unbreakable word).
 */
export async function lineCount(cell: Locator, oneLineHeader: Locator): Promise<number> {
  return Math.round((await contentHeight(cell)) / (await contentHeight(oneLineHeader)));
}

/**
 * Phone check for empty space (#1402). Per row: the row is no taller than its tallest cell's
 * wrapped content plus padding and borders, no cell is 8 lines or more, and the link column is
 * at least 10rem wide.
 */
export async function expectRowsHugContent(table: Locator, linkText: string) {
  const rows = await table.evaluate((t, link) => {
    return [...t.querySelectorAll('tr')].map((tr) => {
      const cells = [...tr.querySelectorAll<HTMLElement>('th, td')].map((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const style = getComputedStyle(cell);
        const lineHeight = parseFloat(style.lineHeight);
        // Lines of text: client rects whose tops are more than half a line apart are on different lines.
        const tops = [...range.getClientRects()].map((r) => r.top).sort((x, y) => x - y);
        const lines = tops.filter((top, i) => i === 0 || top - tops[i - 1] > lineHeight / 2).length;
        return {
          text: cell.textContent ?? '',
          width: cell.getBoundingClientRect().width,
          lines,
          lineHeight,
          // Padding and the cell's computed borders (a collapsed border adds up to its full width to the row).
          chrome: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth),
          isLink: (cell.textContent ?? '').startsWith(link),
        };
      });
      return { height: tr.getBoundingClientRect().height, cells };
    });
  }, linkText);
  for (const row of rows) {
    const tallest = Math.max(...row.cells.map((c) => c.lines * c.lineHeight + c.chrome));
    expect(row.height, JSON.stringify(row)).toBeLessThanOrEqual(tallest + 2);
    const link = row.cells.find((c) => c.isLink);
    if (!link) continue;
    expect(link.width).toBeGreaterThanOrEqual(10 * 16 - 1);
    // No cell stacks into a tall sliver: the old URL-only guard, for every cell.
    for (const c of row.cells) expect(c.lines, c.text).toBeLessThan(8);
  }
}
