// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { letEdgeSwipesThrough } from '@/lib/edgeSwipe';

// Stands in for the dialog scroll lock's document listener, which cancels sideways moves.
let seen: string[] = [];
const lock = (event: Event) => seen.push(event.type);
document.addEventListener('touchstart', lock);
document.addEventListener('touchmove', lock);

function touch(type: 'touchstart' | 'touchmove', x: number, identifier = 1) {
  const point = { identifier, clientX: x, clientY: 400 };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: [point] });
  document.body.dispatchEvent(event);
}

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  seen = [];
});

describe('letEdgeSwipesThrough', () => {
  it('keeps the moves of a touch that starts at the left edge from the page', () => {
    stop = letEdgeSwipesThrough();
    touch('touchstart', 2);
    touch('touchmove', 120);
    // The start still reaches the page, so a tap at the edge works.
    expect(seen).toEqual(['touchstart']);
  });

  it('leaves a touch that starts away from the edge alone', () => {
    stop = letEdgeSwipesThrough();
    touch('touchstart', 200);
    touch('touchmove', 120);
    expect(seen).toEqual(['touchstart', 'touchmove']);
  });

  it('stops after the returned function is called', () => {
    letEdgeSwipesThrough()();
    touch('touchstart', 2);
    touch('touchmove', 120);
    expect(seen).toEqual(['touchstart', 'touchmove']);
  });
});
