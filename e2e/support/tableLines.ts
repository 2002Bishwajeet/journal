import type { Locator } from '@playwright/test';

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
