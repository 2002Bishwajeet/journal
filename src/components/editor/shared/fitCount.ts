/** The gap between items (`gap-0.5`) and the More button's width (`p-2` around an 18 px icon), in px. */
const GAP = 2;
const MORE_WIDTH = 34;

/** How many leading items fit in `available` px, with the More button after them when any are left out. */
export function fitCount(widths: number[], dividers: boolean[], available: number): number {
  const all = widths.reduce((sum, w) => sum + w, 0) + GAP * (widths.length - 1);
  if (all <= available) return widths.length;
  let used = MORE_WIDTH;
  let count = 0;
  while (count < widths.length && used + GAP + widths[count] <= available) {
    used += GAP + widths[count];
    count++;
  }
  // A divider right before More would separate nothing.
  while (count > 0 && dividers[count - 1]) count--;
  return count;
}
