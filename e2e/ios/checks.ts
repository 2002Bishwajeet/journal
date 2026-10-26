// Mobile layout checks for the iOS Safari job (#799): `measureLayout` runs in
// Safari, `layoutProblems` and `safeAreaProblem` judge its result in Node.

export type Rect = { top: number; bottom: number; left: number; right: number };
export type Insets = { top: number; right: number; bottom: number; left: number };

export type Layout = {
  origin: string;
  scrollWidth: number;
  innerWidth: number;
  innerHeight: number;
  /** The visual viewport (what is on screen above the keyboard), in layout-viewport coordinates. */
  viewport: { top: number; height: number };
  insets: Insets;
  /** The focused text field, if any. */
  focused: { name: string; fontSize: number } | null;
  /** The caret, when the focused field is the editor. */
  caret: Rect | null;
  /** The mobile editor toolbar (MobileToolbar), shown while the keyboard is up. */
  toolbar: Rect | null;
  /** The sidebar's last button ("Log out"), the bottom of the shell at the root. */
  sidebarFooter: Rect | null;
  /** Requests that left the app origin. Safari can't fence them like Playwright does, so they are caught afterwards. */
  foreignRequests: string[];
};

/**
 * Runs in the page. WebdriverIO sends the function's source, so it must not use
 * anything from outside its own body.
 */
export function measureLayout(): Layout {
  const box = (r: DOMRect | undefined): Rect | null =>
    r && (r.width || r.height) ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
  const shown = (el: Element | null | undefined) => (el && el.getClientRects().length ? el : null);

  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
  document.body.appendChild(probe);
  const pad = getComputedStyle(probe);
  const insets = {
    top: parseFloat(pad.paddingTop),
    right: parseFloat(pad.paddingRight),
    bottom: parseFloat(pad.paddingBottom),
    left: parseFloat(pad.paddingLeft),
  };
  probe.remove();

  const active = document.activeElement as HTMLElement | null;
  const field = active && (active.matches('input, textarea, select') || active.isContentEditable) ? active : null;
  const selection = getSelection();
  const range = field?.isContentEditable && selection?.rangeCount ? selection.getRangeAt(0) : null;
  const toolbar = [...document.querySelectorAll('button[title="Undo"]')].map((b) => b.closest('.fixed')).find(Boolean);
  const logOut = [...document.querySelectorAll('[aria-label="Sidebar"] button')].find((b) => b.textContent?.trim() === 'Log out');
  const vv = window.visualViewport;

  return {
    origin: location.origin,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth,
    innerHeight,
    viewport: { top: vv ? vv.offsetTop : 0, height: vv ? vv.height : innerHeight },
    insets,
    focused: field
      ? { name: field.isContentEditable ? 'editor' : `${field.tagName.toLowerCase()}[${field.getAttribute('placeholder') ?? ''}]`, fontSize: parseFloat(getComputedStyle(field).fontSize) }
      : null,
    caret: range ? box(range.getClientRects()[0] ?? range.getBoundingClientRect()) : null,
    toolbar: box(shown(toolbar)?.getBoundingClientRect()),
    sidebarFooter: box(shown(logOut)?.getBoundingClientRect()),
    foreignRequests: performance
      .getEntriesByType('resource')
      .map((e) => new URL(e.name))
      .filter((u) => u.protocol.startsWith('http') && u.origin !== location.origin && !u.hostname.endsWith('.homebase.test'))
      .map((u) => u.href),
  };
}

// Sub-pixel rounding differs between properties, so allow one pixel.
const SLACK = 1;

/** What is wrong with a measured layout. `keyboardUp`: the software keyboard is showing. */
export function layoutProblems(m: Layout, keyboardUp: boolean): string[] {
  const problems: string[] = [];
  const visibleBottom = m.viewport.top + m.viewport.height;
  const onScreen = (r: Rect) => r.top >= m.viewport.top - SLACK && r.bottom <= visibleBottom + SLACK;
  const span = (r: Rect) => `${Math.round(r.top)}–${Math.round(r.bottom)}`;
  const visible = `${Math.round(m.viewport.top)}–${Math.round(visibleBottom)}`;

  if (m.scrollWidth > m.innerWidth) {
    problems.push(`the page scrolls sideways: scrollWidth ${m.scrollWidth} > innerWidth ${m.innerWidth}`);
  }
  if (m.focused && m.focused.fontSize < 16) {
    problems.push(`the focused ${m.focused.name} is ${m.focused.fontSize}px; iOS zooms into fields under 16px`);
  }
  if (keyboardUp) {
    if (!m.caret) problems.push('the keyboard is up but there is no caret');
    else if (!onScreen(m.caret)) problems.push(`the caret (${span(m.caret)}) is outside the visual viewport (${visible})`);
    if (!m.toolbar) problems.push('the keyboard is up but the mobile toolbar is not shown');
    else if (!onScreen(m.toolbar)) problems.push(`the mobile toolbar (${span(m.toolbar)}) is outside the visual viewport (${visible})`);
  }
  const usableBottom = Math.min(m.innerHeight, visibleBottom) - m.insets.bottom;
  // With a field focused the keyboard covers the bottom of the page, the sidebar footer included.
  if (!m.focused && m.sidebarFooter && m.sidebarFooter.bottom > usableBottom + SLACK) {
    problems.push(`the sidebar footer ends at ${Math.round(m.sidebarFooter.bottom)}, below the usable bottom ${Math.round(usableBottom)} (viewport minus the safe area)`);
  }
  if (m.foreignRequests.length) {
    problems.push(`requests left the test origin: ${m.foreignRequests.join(', ')}`);
  }
  return problems;
}

/** A notched iPhone reports a non-zero safe area in some orientation, if the page opted in with viewport-fit=cover. */
export function safeAreaProblem(measured: Insets[]): string | null {
  return measured.some((i) => i.top > 0 || i.right > 0 || i.bottom > 0 || i.left > 0)
    ? null
    : 'every safe-area inset is 0 on a notched iPhone, in portrait and landscape (is viewport-fit=cover set?)';
}

/** What `startGestureProbe` saw during one touch gesture on the note list (#778). */
export type GestureProbe = {
  /** The list's lowest and highest scrollTop. WebKit's rubber band shows as a negative scrollTop. */
  minTop: number;
  maxTop: number;
  /** How far the pull-to-refresh content moved down. */
  maxPull: number;
  /** How far the page itself moved (scrollY or the visual viewport offset). */
  pageMoved: number;
  /** The largest swipe offset of any row during the gesture, and of the first row at the end. */
  maxRowOffset: number;
  firstRowOffset: number;
};

/**
 * Runs in the page: samples the note list every frame until `stopGestureProbe`.
 * Like `measureLayout`, it must not use anything from outside its own body.
 */
export function startGestureProbe(): void {
  const rows = () => [...document.querySelectorAll('[data-testid="note-row"] [role="button"]')];
  const offset = (el: Element | undefined) => {
    const t = el ? getComputedStyle(el).transform : 'none';
    return t === 'none' ? 0 : Math.abs(new DOMMatrix(t).m41);
  };
  const list = document.querySelector('[data-testid="note-row"]')!.closest('[data-radix-scroll-area-viewport]')!;
  const pulled = list.querySelector('[data-pull-to-refresh] > div:last-child')!;
  const p: GestureProbe = { minTop: list.scrollTop, maxTop: list.scrollTop, maxPull: 0, pageMoved: 0, maxRowOffset: 0, firstRowOffset: 0 };
  const w = window as unknown as { __gestureProbe?: { p: GestureProbe; stop: boolean } };
  const probe = { p, stop: false };
  w.__gestureProbe = probe;
  const sample = () => {
    const t = getComputedStyle(pulled).transform;
    p.minTop = Math.min(p.minTop, list.scrollTop);
    p.maxTop = Math.max(p.maxTop, list.scrollTop);
    p.maxPull = Math.max(p.maxPull, t === 'none' ? 0 : new DOMMatrix(t).m42);
    p.pageMoved = Math.max(p.pageMoved, Math.abs(scrollY), Math.abs(visualViewport?.offsetTop ?? 0));
    p.maxRowOffset = Math.max(p.maxRowOffset, ...rows().map(offset));
    p.firstRowOffset = offset(rows()[0]);
    if (!probe.stop) requestAnimationFrame(sample);
  };
  sample();
}

/** Runs in the page: stops the probe and returns what it saw. */
export function stopGestureProbe(): GestureProbe {
  const probe = (window as unknown as { __gestureProbe: { p: GestureProbe; stop: boolean } }).__gestureProbe;
  probe.stop = true;
  return probe.p;
}

export type Gesture = 'swipe' | 'drift-scroll' | 'pull' | 'scroll-after-pull';

/** What is wrong with how the note list followed a gesture (#778). */
export function gestureProblems(gesture: Gesture, p: GestureProbe): string[] {
  const problems: string[] = [];
  if (p.pageMoved > SLACK) problems.push(`the page itself moved ${Math.round(p.pageMoved)}px`);
  switch (gesture) {
    case 'swipe':
      if (Math.abs(p.firstRowOffset - 80) > SLACK) problems.push(`the swiped row is open ${Math.round(p.firstRowOffset)}px, not 80px`);
      break;
    case 'drift-scroll':
      if (p.maxTop < 50) problems.push(`the list scrolled only ${Math.round(p.maxTop)}px`);
      if (p.maxRowOffset > SLACK) problems.push(`a row slid ${Math.round(p.maxRowOffset)}px during a vertical scroll`);
      break;
    case 'pull':
      if (p.maxPull < 30) problems.push(`the pull moved the list only ${Math.round(p.maxPull)}px`);
      if (p.minTop < -SLACK) problems.push(`the list rubber-banded to scrollTop ${Math.round(p.minTop)} during the pull`);
      if (p.maxTop > SLACK) problems.push(`the list scrolled to ${Math.round(p.maxTop)} during the pull`);
      break;
    case 'scroll-after-pull':
      if (p.maxTop < 50) problems.push(`the list stuck at the top: it scrolled only ${Math.round(p.maxTop)}px after the pull`);
      break;
  }
  return problems;
}
