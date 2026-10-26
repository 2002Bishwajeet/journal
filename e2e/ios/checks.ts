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
  /** The footer (action buttons) of an open dialog. */
  dialogFooter: Rect | null;
  /** The full-screen Search sheet on a phone (#780). */
  searchSheet: Rect | null;
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
    dialogFooter: box(shown(document.querySelector('[role="dialog"] [data-slot="dialog-footer"]'))?.getBoundingClientRect()),
    searchSheet: box(shown(document.querySelector('[role="dialog"][aria-label="Search notes"]'))?.getBoundingClientRect()),
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
  // A dialog's buttons must stay above the keyboard while one of its fields has focus (#783).
  if (m.focused && m.dialogFooter && !onScreen(m.dialogFooter)) {
    problems.push(`the dialog buttons (${span(m.dialogFooter)}) are outside the visual viewport (${visible})`);
  }
  // The Search sheet ends above the keyboard, so its last results can be scrolled into view (#780).
  if (m.focused && m.searchSheet && !onScreen(m.searchSheet)) {
    problems.push(`the search sheet (${span(m.searchSheet)}) is outside the visual viewport (${visible})`);
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
