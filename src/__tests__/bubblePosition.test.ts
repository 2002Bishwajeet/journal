import { describe, it, expect } from 'vitest';
import { placeBubble } from '@/lib/editor/bubblePosition';

const base = {
  centerX: 400,
  selectionTop: 300,
  selectionBottom: 320,
  width: 260,
  height: 42,
  viewportWidth: 800,
  viewportHeight: 600,
};

describe('placeBubble', () => {
  it('centres above the selection when there is room', () => {
    expect(placeBubble(base)).toEqual({ left: 270, top: 250 });
  });

  it('clamps to the left margin', () => {
    expect(placeBubble({ ...base, centerX: 20 }).left).toBe(8);
  });

  it('clamps to the right margin', () => {
    expect(placeBubble({ ...base, centerX: 790 }).left).toBe(800 - 8 - 260);
  });

  it('flips below the selection when there is no room above', () => {
    expect(placeBubble({ ...base, selectionTop: 30, selectionBottom: 50 }).top).toBe(58);
  });

  it('stays inside the viewport when neither side has room', () => {
    const { top } = placeBubble({ ...base, selectionTop: 20, selectionBottom: 590 });
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + base.height).toBeLessThanOrEqual(600 - 8);
  });

  it('pins to the left margin when wider than the viewport', () => {
    expect(placeBubble({ ...base, viewportWidth: 200 }).left).toBe(8);
  });
});
