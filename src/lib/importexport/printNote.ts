/**
 * PDF export (#520): the browser's print dialog, where the reader saves the PDF, over the
 * print rules in src/index.css ("Print"). It prints the note as it is drawn now ("static
 * print"): only the note, in the light theme (so the light cover), every toggle open, an
 * html or react block as its frame shows it, a mermaid or svg block as vector. A block's
 * frame reloads when the theme changes, so from the dark theme it prints (and comes back)
 * as it first draws, with what it saved through `journal.storage`.
 */
import { toast } from 'sonner';

/** How long to wait for a frame to load, or for an image, before printing without it. */
const LOAD_TIMEOUT_MS = 1500;
/** How long an open note takes to show up after `open`. */
const OPEN_TIMEOUT_MS = 15000;
/** Time for a mermaid diagram to redraw in the new theme and a block to report its height. */
const SETTLE_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/** The rendered note on screen (a desktop tab kept in the background has no boxes). */
function findNoteRoot(docId: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('[data-print-note]')].find(
      (el) => el.dataset.printNote === docId && el.getClientRects().length > 0,
    ) ?? null
  );
}

/** Prints the note `docId`; `open` shows it first when it isn't on screen (a note list row). */
export async function printNote(docId: string, title: string, open?: () => void): Promise<void> {
  let root = findNoteRoot(docId);
  if (!root && open) {
    open();
    for (const end = Date.now() + OPEN_TIMEOUT_MS; !root && Date.now() < end; root = findNoteRoot(docId)) await sleep(100);
  }
  if (!root) {
    toast.error('Couldn’t open the note to export it');
    return;
  }
  await printElement(root, title || 'Untitled');
}

/** Resolves when `el` (an iframe or img) next loads or fails, or after LOAD_TIMEOUT_MS. */
function loaded(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    el.addEventListener('load', done, { once: true });
    el.addEventListener('error', done, { once: true });
    setTimeout(done, LOAD_TIMEOUT_MS);
  });
}

/** The box `el` scrolls in: the editor's pane, else the page. */
function scrollParent(el: HTMLElement): HTMLElement {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** Scrolls through the whole note and back, so images and frames that load in view all load. */
async function revealAll(root: HTMLElement) {
  const scroller = scrollParent(root);
  const start = scroller.scrollTop;
  for (let top = 0; top < scroller.scrollHeight; top += Math.max(scroller.clientHeight, 1)) {
    scroller.scrollTop = top;
    await nextFrame();
  }
  scroller.scrollTop = start;
}

/** Opens the print dialog with only `root` on the page, then puts the screen back as it was. */
export async function printElement(root: HTMLElement, title: string): Promise<void> {
  const html = document.documentElement;
  const undo: (() => void)[] = [];
  const toastId = toast.loading('Preparing PDF…');
  try {
    // The PDF is always light; a live block's frame takes the theme from <html> (LiveBlockPreview).
    // Native controls (a task's checkbox) follow color-scheme (useThemePreference).
    if (html.classList.replace('dark', 'light')) {
      const { colorScheme } = html.style;
      html.style.colorScheme = 'light';
      undo.push(() => {
        html.classList.replace('light', 'dark');
        html.style.colorScheme = colorScheme;
      });
    }

    // Toggles print open: the editor's through its own button, the share page's <details>.
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-type="toggle"] button[aria-expanded="false"]')) {
      button.click();
      undo.push(() => button.click());
    }
    for (const details of root.querySelectorAll<HTMLDetailsElement>('details:not([open])')) {
      details.open = true;
      undo.push(() => (details.open = false));
    }

    for (const frame of root.querySelectorAll('iframe')) frame.setAttribute('loading', 'eager');
    const frames = [...root.querySelectorAll('iframe')].map(loaded);
    await revealAll(root);
    await Promise.all(frames);
    await sleep(SETTLE_MS);
    await Promise.all([...root.querySelectorAll('img')].filter((img) => !img.complete).map(loaded));

    // Only the root and the elements it sits in print (src/index.css, "Print").
    root.setAttribute('data-print-root', '');
    for (let el = root.parentElement; el && el !== html; el = el.parentElement) el.setAttribute('data-print-path', '');
    html.setAttribute('data-printing', '');
    undo.push(() => {
      html.removeAttribute('data-printing');
      root.removeAttribute('data-print-root');
      for (const el of document.querySelectorAll('[data-print-path]')) el.removeAttribute('data-print-path');
    });
    // The PDF's file name
    const pageTitle = document.title;
    document.title = title;
    undo.push(() => (document.title = pageTitle));

    toast.dismiss(toastId);
    await new Promise<void>((resolve) => {
      window.addEventListener('afterprint', () => resolve(), { once: true });
      window.print();
    });
  } finally {
    toast.dismiss(toastId);
    for (const step of undo.reverse()) step();
  }
}
