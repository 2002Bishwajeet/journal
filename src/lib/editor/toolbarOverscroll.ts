/**
 * Overscroll for the floating mobile toolbar: past either end the buttons follow the
 * finger with resistance (rubber band) and the capsule stretches a little that way,
 * then both spring back. The browser's own overscroll is off on the row
 * (`overscroll-behavior-x: none`), so iOS and Android feel the same.
 */

/** iOS's rubber-band constant: how quickly the resistance grows. */
const RUBBER_BAND = 0.55;
/** Most the capsule stretches, as a fraction of its width. */
export const MAX_STRETCH = 0.04;

/**
 * How far past an end a drag has pulled, in px: positive past the start (finger moved
 * right), negative past the end, 0 while the row can still scroll. `dx` is the finger's
 * movement since the touch began, `startScroll` the row's scrollLeft at that moment.
 */
export function getOverscroll(dx: number, startScroll: number, maxScroll: number): number {
  const scroll = startScroll - dx;
  if (scroll < 0) return -scroll;
  if (scroll > maxScroll) return maxScroll - scroll;
  return 0;
}

/** The distance the content moves for an overscroll, with growing resistance (never beyond `size`). */
export function rubberBand(overscroll: number, size: number): number {
  const distance = Math.abs(overscroll);
  return Math.sign(overscroll) * (1 - 1 / ((distance * RUBBER_BAND) / size + 1)) * size;
}

/** Horizontal scale of the capsule for a rubber-banded offset: 1 at rest, at most 1 + MAX_STRETCH. */
export function getStretch(offset: number, size: number): number {
  return 1 + Math.min(MAX_STRETCH, Math.abs(offset) / size / 2);
}

/**
 * A CSS `linear()` easing that follows a spring from 0 to 1, with Apple's parameters:
 * `duration` is the period in ms, `bounce` 0 (none) to 1. Firm, not bouncy: 0.15.
 * Sampled until the spring settles; returns the easing and how long that takes.
 */
export function springEasing(duration = 400, bounce = 0.15): { easing: string; ms: number } {
  const omega = (2 * Math.PI) / duration;
  const zeta = 1 - bounce;
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  const at = (t: number) =>
    1 - Math.exp(-zeta * omega * t) * (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t));
  let ms = duration;
  while (Math.abs(1 - at(ms)) > 0.001 && ms < 4 * duration) ms += 10;
  const steps = 40;
  const points = Array.from({ length: steps + 1 }, (_, i) => Number(at((ms * i) / steps).toFixed(4)));
  points[steps] = 1;
  return { easing: `linear(${points.join(", ")})`, ms };
}
