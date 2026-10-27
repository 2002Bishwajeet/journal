import './styles.css';

const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const THEME_KEY = 'journal-site-theme';

// ---- Theme: the inline script in index.html set data-theme before paint ----

const toggle = document.querySelector<HTMLButtonElement>('.theme-toggle')!;

function applyTheme(theme: 'light' | 'dark'): void {
  root.dataset.theme = theme;
  toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  window.dispatchEvent(new Event('themechange'));
}

function storedTheme(): string | null {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

applyTheme(root.dataset.theme === 'dark' ? 'dark' : 'light');
toggle.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  applyTheme(next);
});
// With no choice of their own, the page follows the system as it changes.
systemDark.addEventListener('change', (e) => {
  if (!storedTheme()) applyTheme(e.matches ? 'dark' : 'light');
});

// ---- Navigation: a tone step once the page has scrolled; the phone menu closes on a pick ----

const nav = document.querySelector<HTMLElement>('.nav')!;
const onScroll = () => nav.toggleAttribute('data-scrolled', window.scrollY > 8);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

const menu = document.querySelector<HTMLDetailsElement>('.menu')!;
menu.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('a')) menu.open = false;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu.open) {
    menu.open = false;
    menu.querySelector('summary')!.focus();
  }
});

// ---- Entrances: each part rises into place once, as its section arrives ----

const revealed = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in');
      revealed.unobserve(entry.target);
    }
  },
  // The large top margin counts anything already scrolled past as arrived, so a fast scroll leaves no blanks.
  { rootMargin: '100000px 0px -8% 0px' },
);
document.querySelectorAll('[data-reveal]').forEach((el) => revealed.observe(el));

// ---- Home hero video: one take per theme; only the one on screen loads and plays ----
// Phones get a still screenshot instead (CSS hides both takes), and reduced motion gets controls.

const videos = [...document.querySelectorAll<HTMLVideoElement>('video.hero-video')];
const heroMedia = document.querySelector<HTMLElement>('.hero-media');
let heroInView = false;

function syncVideos(): void {
  for (const video of videos) {
    const shown = video.getClientRects().length > 0;
    if (reducedMotion.matches) {
      video.controls = shown;
      if (!shown) video.pause();
    } else if (shown && heroInView) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }
}
if (heroMedia) {
  new IntersectionObserver(([entry]) => {
    heroInView = entry.isIntersecting;
    syncVideos();
  }).observe(heroMedia);
  window.addEventListener('themechange', syncVideos);
  matchMedia('(max-width: 599px)').addEventListener('change', syncVideos);
}

// ---- Agents page: install tabs, one per client (arrow keys, Home and End move between them) ----

document.querySelectorAll<HTMLElement>('[role="tablist"]').forEach((list) => {
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (next: HTMLButtonElement) => {
    for (const tab of tabs) {
      const on = tab === next;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')!)!.hidden = !on;
    }
    next.focus();
  };
  list.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
    if (tab) select(tab);
  });
  list.addEventListener('keydown', (e) => {
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (to === undefined || at < 0) return;
    e.preventDefault();
    select(tabs[(to + tabs.length) % tabs.length]);
  });
});

// ---- Agents page: copy an install snippet ----

document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
  const label = button.querySelector('.copy-label')!;
  let timer: number | undefined;
  button.addEventListener('click', async () => {
    const text = document.getElementById(button.dataset.copy!)!.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      label.textContent = 'Copied';
      button.toggleAttribute('data-copied', true);
    } catch {
      label.textContent = 'Select and copy';
    }
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      label.textContent = 'Copy';
      button.toggleAttribute('data-copied', false);
    }, 1800);
  });
});

// ---- Home Mermaid playground: mermaid loads only when the section comes near ----

const playground = document.querySelector<HTMLElement>('.playground');
if (playground) {
  const near = new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) return;
      near.disconnect();
      import('./playground').then(({ startPlayground }) => startPlayground(playground));
    },
    { rootMargin: '400px 0px' },
  );
  near.observe(playground);
}
