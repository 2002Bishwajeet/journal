import { describe, expect, it } from 'vitest';
import { gestureProblems, layoutProblems, safeAreaProblem, type GestureProbe, type Layout } from '../../e2e/ios/checks';

// A clean iPhone 15 portrait layout in Safari, keyboard down.
const ok: Layout = {
  origin: 'http://127.0.0.1:4173',
  scrollWidth: 393,
  innerWidth: 393,
  innerHeight: 659,
  viewport: { top: 0, height: 659 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
  focused: null,
  caret: null,
  toolbar: null,
  dialogFooter: null,
  searchSheet: null,
  sidebarFooter: { top: 610, bottom: 642, left: 8, right: 385 },
  foreignRequests: [],
};

// Keyboard up: the visual viewport shrinks to the 323px above it.
const keyboard: Layout = {
  ...ok,
  viewport: { top: 0, height: 323 },
  focused: { name: 'editor', fontSize: 16 },
  caret: { top: 200, bottom: 220, left: 20, right: 20 },
  toolbar: { top: 275, bottom: 323, left: 0, right: 393 },
  sidebarFooter: null,
};

describe('iOS Safari layout checks', () => {
  it('should pass a clean layout, with and without the keyboard', () => {
    expect(layoutProblems(ok, false)).toEqual([]);
    expect(layoutProblems(keyboard, true)).toEqual([]);
  });

  it('should flag sideways scrolling', () => {
    expect(layoutProblems({ ...ok, scrollWidth: 420 }, false)).toEqual([
      'the page scrolls sideways: scrollWidth 420 > innerWidth 393',
    ]);
  });

  it('should flag a focused field under 16px, which iOS zooms into', () => {
    const problems = layoutProblems({ ...ok, focused: { name: 'input[Folder Name]', fontSize: 14 } }, false);
    expect(problems).toEqual(['the focused input[Folder Name] is 14px; iOS zooms into fields under 16px']);
  });

  it('should flag a shell sized with 100vh whose footer ends under Safari’s toolbar', () => {
    // 100vh is the viewport with Safari's toolbar hidden, taller than innerHeight.
    const problems = layoutProblems({ ...ok, sidebarFooter: { top: 700, bottom: 732, left: 8, right: 385 } }, false);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/sidebar footer ends at 732, below the usable bottom 659/);
  });

  it('should keep the sidebar footer clear of the bottom safe area', () => {
    const problems = layoutProblems({ ...ok, insets: { ...ok.insets, bottom: 34 } }, false);
    expect(problems[0]).toMatch(/below the usable bottom 625/);
  });

  it('should not flag the sidebar footer under the keyboard while a dialog field is focused', () => {
    const dialogField = { ...ok, viewport: { top: 0, height: 436 }, focused: { name: 'input[Folder Name]', fontSize: 16 }, sidebarFooter: { top: 619, bottom: 651, left: 8, right: 385 } };
    expect(layoutProblems(dialogField, false)).toEqual([]);
  });

  it('should flag dialog buttons under the keyboard while a dialog field is focused', () => {
    const field = { ...ok, viewport: { top: 0, height: 436 }, focused: { name: 'input[Folder Name]', fontSize: 16 }, sidebarFooter: null };
    expect(layoutProblems({ ...field, dialogFooter: { top: 380, bottom: 424, left: 24, right: 369 } }, false)).toEqual([]);
    expect(layoutProblems({ ...field, dialogFooter: { top: 410, bottom: 506, left: 24, right: 369 } }, false)).toEqual([
      'the dialog buttons (410–506) are outside the visual viewport (0–436)',
    ]);
  });

  it('should flag a search sheet that runs under the keyboard while its field is focused', () => {
    const field = { ...ok, viewport: { top: 0, height: 420 }, focused: { name: 'input[Search notes...]', fontSize: 18 }, sidebarFooter: null };
    expect(layoutProblems({ ...field, searchSheet: { top: 0, bottom: 420, left: 0, right: 393 } }, false)).toEqual([]);
    expect(layoutProblems({ ...field, searchSheet: { top: 0, bottom: 659, left: 0, right: 393 } }, false)).toEqual([
      'the search sheet (0–659) is outside the visual viewport (0–420)',
    ]);
  });

  it('should flag a caret or toolbar hidden behind the keyboard', () => {
    const problems = layoutProblems(
      { ...keyboard, caret: { top: 400, bottom: 420, left: 20, right: 20 }, toolbar: { top: 611, bottom: 659, left: 0, right: 393 } },
      true,
    );
    expect(problems).toEqual([
      'the caret (400–420) is outside the visual viewport (0–323)',
      'the mobile toolbar (611–659) is outside the visual viewport (0–323)',
    ]);
  });

  it('should use the visual viewport offset when Safari scrolls the page up for the keyboard', () => {
    // On screen: 300–623 of the layout viewport.
    const scrolled = { ...keyboard, viewport: { top: 300, height: 323 }, caret: { top: 400, bottom: 420, left: 20, right: 20 } };
    expect(layoutProblems({ ...scrolled, toolbar: { top: 575, bottom: 623, left: 0, right: 393 } }, true)).toEqual([]);
    expect(layoutProblems(scrolled, true)).toEqual(['the mobile toolbar (275–323) is outside the visual viewport (300–623)']);
  });

  it('should flag a missing caret or toolbar only while the keyboard is up', () => {
    const bare = { ...keyboard, caret: null, toolbar: null };
    expect(layoutProblems(bare, false)).toEqual([]);
    expect(layoutProblems(bare, true)).toEqual([
      'the keyboard is up but there is no caret',
      'the keyboard is up but the mobile toolbar is not shown',
    ]);
  });

  it('should flag requests that left the test origin', () => {
    const problems = layoutProblems({ ...ok, foreignRequests: ['https://fonts.example.com/a.woff2'] }, false);
    expect(problems).toEqual(['requests left the test origin: https://fonts.example.com/a.woff2']);
  });

  it('should require a non-zero safe area in some orientation', () => {
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    expect(safeAreaProblem([none, none])).toMatch(/viewport-fit=cover/);
    expect(safeAreaProblem([none, { ...none, left: 59 }])).toBeNull();
  });
});

// What the note list did during one gesture, with nothing wrong (#778).
const still: GestureProbe = { minTop: 0, maxTop: 0, maxPull: 0, pageMoved: 0, maxRowOffset: 0, firstRowOffset: 0 };

describe('iOS Safari note list gesture checks', () => {
  it('should pass gestures the list followed', () => {
    expect(gestureProblems('swipe', { ...still, maxRowOffset: 84, firstRowOffset: 80 })).toEqual([]);
    expect(gestureProblems('drift-scroll', { ...still, maxTop: 240 })).toEqual([]);
    expect(gestureProblems('pull', { ...still, maxPull: 75 })).toEqual([]);
    expect(gestureProblems('scroll-after-pull', { ...still, maxTop: 240 })).toEqual([]);
  });

  it('should flag a swipe that left the row shut', () => {
    expect(gestureProblems('swipe', still)).toEqual(['the swiped row is open 0px, not 80px']);
  });

  it('should flag a row that slid during a vertical scroll, or a scroll that did not happen', () => {
    expect(gestureProblems('drift-scroll', { ...still, maxTop: 10, maxRowOffset: 35 })).toEqual([
      'the list scrolled only 10px',
      'a row slid 35px during a vertical scroll',
    ]);
  });

  it('should flag a pull that WebKit rubber-banded or scrolled instead', () => {
    expect(gestureProblems('pull', { ...still, minTop: -60, maxTop: 12, pageMoved: 40 })).toEqual([
      'the page itself moved 40px',
      'the pull moved the list only 0px',
      'the list rubber-banded to scrollTop -60 during the pull',
      'the list scrolled to 12 during the pull',
    ]);
  });

  it('should flag a list stuck at the top after a pull', () => {
    expect(gestureProblems('scroll-after-pull', still)).toEqual(['the list stuck at the top: it scrolled only 0px after the pull']);
  });
});
