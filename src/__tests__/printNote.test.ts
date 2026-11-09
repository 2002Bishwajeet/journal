// @vitest-environment happy-dom
/** #520: Export to PDF prints the note alone, light, with every toggle open, then puts the screen back. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ loading: vi.fn(() => 't1'), dismiss: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

import { printElement, printNote } from '@/lib/importexport/printNote';

/** A page like the app's: a sidebar beside a pane that holds the note, and a toaster outside both. */
function mountNote() {
  document.documentElement.className = 'dark';
  document.documentElement.style.colorScheme = 'dark';
  document.title = 'Journal';
  document.body.innerHTML = `
    <div id="app">
      <nav id="sidebar">Folders</nav>
      <div id="pane">
        <div id="note" data-print-note="n1">
          <div data-type="toggle"><div><button aria-expanded="false">Expand</button></div></div>
          <details id="details"><summary>More</summary>Body</details>
          <iframe loading="lazy"></iframe>
        </div>
      </div>
    </div>
    <div id="toaster"></div>`;
  const note = document.getElementById('note')!;
  // The toggle node view flips aria-expanded on a click (ToggleNodeView)
  const toggle = note.querySelector('button')!;
  toggle.addEventListener('click', () => toggle.setAttribute('aria-expanded', String(toggle.getAttribute('aria-expanded') !== 'true')));
  return note;
}

/** The page as it was while the print dialog was open. */
function capturePrint() {
  const seen: Record<string, unknown> = {};
  // happy-dom has no print dialog
  window.print = vi.fn(() => {
    const html = document.documentElement;
    Object.assign(seen, {
      theme: html.className,
      scheme: html.style.colorScheme,
      printing: html.hasAttribute('data-printing'),
      root: document.querySelector('[data-print-root]')?.id,
      path: [...document.querySelectorAll('[data-print-path]')].map((el) => el.id || el.tagName.toLowerCase()),
      toggleOpen: document.querySelector('[data-type="toggle"] button')?.getAttribute('aria-expanded'),
      detailsOpen: (document.getElementById('details') as HTMLDetailsElement).open,
      title: document.title,
      frameLoading: document.querySelector('iframe')?.getAttribute('loading'),
    });
    window.dispatchEvent(new Event('afterprint'));
  });
  return seen;
}

describe('printElement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prints only the note and what it sits in, light, every toggle open, under its title', async () => {
    const seen = capturePrint();

    await printElement(mountNote(), 'Trip notes');

    expect(seen).toEqual({
      theme: 'light',
      scheme: 'light',
      printing: true,
      root: 'note',
      path: ['body', 'app', 'pane'],
      toggleOpen: 'true',
      detailsOpen: true,
      title: 'Trip notes',
      frameLoading: 'eager',
    });
  });

  it('puts the theme, the toggles and the title back once the dialog closes', async () => {
    capturePrint();

    await printElement(mountNote(), 'Trip notes');

    const html = document.documentElement;
    expect(html.className).toBe('dark');
    expect(html.style.colorScheme).toBe('dark');
    expect(html.hasAttribute('data-printing')).toBe(false);
    expect(document.querySelectorAll('[data-print-root], [data-print-path]')).toHaveLength(0);
    expect(document.querySelector('[data-type="toggle"] button')?.getAttribute('aria-expanded')).toBe('false');
    expect((document.getElementById('details') as HTMLDetailsElement).open).toBe(false);
    expect(document.title).toBe('Journal');
    expect(toast.dismiss).toHaveBeenCalledWith('t1');
  });

  it('leaves the light theme as it is', async () => {
    const seen = capturePrint();
    const note = mountNote();
    document.documentElement.className = 'light';

    await printElement(note, 'Trip notes');

    expect(seen.theme).toBe('light');
    expect(document.documentElement.className).toBe('light');
  });
});

describe('printNote', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prints the note on screen, untitled as Untitled', async () => {
    const seen = capturePrint();
    mountNote();
    const open = vi.fn();

    await printNote('n1', '', open);

    expect(open).not.toHaveBeenCalled();
    expect(seen.root).toBe('note');
    expect(seen.title).toBe('Untitled');
  });

  it('opens a note that is not on screen, then prints it once it shows', async () => {
    const seen = capturePrint();
    document.body.innerHTML = '';
    const open = vi.fn(() => setTimeout(mountNote, 50));

    await printNote('n1', 'Trip notes', open);

    expect(open).toHaveBeenCalledOnce();
    expect(seen.root).toBe('note');
  });

  it('says so when the note never shows', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    window.print = vi.fn();

    const done = printNote('missing', 'Trip notes', vi.fn());
    await vi.advanceTimersByTimeAsync(20_000);
    await done;
    vi.useRealTimers();

    expect(window.print).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});
