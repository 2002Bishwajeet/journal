/**
 * PDF export (#520): the browser's print dialog, where the reader saves the PDF, over the
 * print rules in src/index.css ("Print"). It prints the note as it is drawn now ("static
 * print"): only the note, in the light theme (so the light cover), every toggle open, an
 * html or react block as its frame shows it, a mermaid or svg block as vector. A block's
 * frame reloads when the theme changes, so from the dark theme it prints (and comes back)
 * as it first draws, with what it saved through `journal.storage`.
 */
import { toast } from 'sonner';
import { revealIntersections } from '@/hooks/useIntersection';

/** How long to wait for a frame to load, or for an image, before printing without it. */
const LOAD_TIMEOUT_MS = 1500;
/** How long an open note takes to show up after `open`. */
const OPEN_TIMEOUT_MS = 15000;
/** Time for a lazy image to start loading, a mermaid diagram to redraw in the new theme and a block to report its height. */
const SETTLE_MS = 300;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The rendered note on screen (a desktop tab kept in the background has no boxes). */
function findNoteRoot(docId: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>('[data-print-note]')].find(
      (el) => el.dataset.printNote === docId && el.getClientRects().length > 0,
    ) ?? null
  );
}

/** Prints the note `docId`; `open` shows it first when it isn't on screen (a note list row). */
export async function printNote(docId: string, title: string, open?: (docId: string) => void): Promise<void> {
  let root = findNoteRoot(docId);
  if (!root && open) {
    open(docId);
    for (const end = Date.now() + OPEN_TIMEOUT_MS; !root && Date.now() < end; root = findNoteRoot(docId)) await sleep(100);
  }
  if (!root) {
    toast.error('Couldn’t open the note to export it');
    return;
  }
  await printElement(root, title);
}

/** Resolves when `el` (an iframe or img) next loads or fails, or after LOAD_TIMEOUT_MS. */
function loaded(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, LOAD_TIMEOUT_MS);
    function done() {
      clearTimeout(timer);
      el.removeEventListener('load', done);
      el.removeEventListener('error', done);
      resolve();
    }
    el.addEventListener('load', done);
    el.addEventListener('error', done);
  });
}

/** Whether `el` is out of the window, where a lazy frame has not loaded yet. */
const offScreen = (el: Element) => {
  const { top, bottom } = el.getBoundingClientRect();
  return bottom < 0 || top > window.innerHeight;
};

/** Opens the print dialog with only `root` on the page, then puts the screen back as it was. */
export async function printElement(root: HTMLElement, title: string): Promise<void> {
  const html = document.documentElement;
  const undo: (() => void)[] = [];
  const toastId = toast.loading('Preparing PDF…');
  try {
    // The PDF is always light; a live block's frame takes the theme from <html> (LiveBlockPreview).
    // Native controls (a task's checkbox) follow color-scheme (useThemePreference).
    const flipped = html.classList.replace('dark', 'light');
    if (flipped) {
      const { colorScheme } = html.style;
      html.style.colorScheme = 'light';
      undo.push(() => {
        html.classList.replace('light', 'dark');
        html.style.colorScheme = colorScheme;
      });
    }

    // Toggles print open: the editor's through its own button (preflight's `[hidden]` rule is
    // !important in a layer, so no print rule can show its content), the share page's <details>.
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-type="toggle"] button[aria-expanded="false"]')) {
      button.click();
      undo.push(() => button.click());
    }
    for (const details of root.querySelectorAll<HTMLDetailsElement>('details:not([open])')) {
      details.open = true;
      undo.push(() => (details.open = false));
    }

    // Everything that loads once in view loads now. An html or react frame reloads in the new
    // theme (a mermaid one redraws in place); one out of the window may not have loaded yet.
    revealIntersections(root);
    for (const img of root.querySelectorAll('img[loading="lazy"]')) img.setAttribute('loading', 'eager');
    const frames = [...root.querySelectorAll('iframe')].filter((frame) => {
      frame.setAttribute('loading', 'eager');
      return (flipped && frame.title !== 'Mermaid preview') || offScreen(frame);
    });
    await Promise.all([...frames.map(loaded), sleep(SETTLE_MS)]);
    await Promise.all([...root.querySelectorAll('img')].filter((img) => !img.complete).map(loaded));

    // Only the root and the elements it sits in print (src/index.css, "Print").
    const path: Element[] = [];
    for (let el = root.parentElement; el && el !== html; el = el.parentElement) path.push(el);
    root.setAttribute('data-print-root', '');
    for (const el of path) el.setAttribute('data-print-path', '');
    undo.push(() => {
      root.removeAttribute('data-print-root');
      for (const el of path) el.removeAttribute('data-print-path');
    });
    // The PDF's file name
    const pageTitle = document.title;
    document.title = title || 'Untitled';
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
