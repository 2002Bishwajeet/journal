/** A grouped list in a sheet (#833): rows on a muted card with hairlines between them. A pressed
 *  row tints to the border colour, which shows on the muted card in both themes. */
export const sheetGroup =
  "bg-muted divide-border divide-y overflow-hidden rounded-xl [--press-row-bg:var(--border)]"
/** A pressed row tints instead of fading (.press-row in index.css) and the tint fades out on release. */
export const sheetRowPress =
  "press-row active:bg-[var(--press-row-bg,var(--accent))] transition-colors duration-(--duration-fade) ease-(--ease-standard)"
