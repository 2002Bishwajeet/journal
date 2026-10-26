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

// ---- Navigation: a hairline only once the page has scrolled; the phone menu closes on a pick ----

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
  { rootMargin: '0px 0px -8% 0px' },
);
document.querySelectorAll('[data-reveal]').forEach((el) => revealed.observe(el));

// ---- Hero video: still under reduced motion, and paused while off screen ----

const video = document.querySelector<HTMLVideoElement>('video.demo')!;
if (reducedMotion.matches) {
  video.removeAttribute('autoplay');
  video.pause();
  video.controls = true;
} else {
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) video.play().catch(() => {});
    else video.pause();
  }).observe(video);
}

// ---- Copy the MCP install snippet ----

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

// ---- Mermaid playground: mermaid loads only when the section comes near ----

const playground = document.querySelector<HTMLElement>('.playground')!;
const near = new IntersectionObserver(
  ([entry]) => {
    if (!entry.isIntersecting) return;
    near.disconnect();
    import('./playground').then(({ startPlayground }) => startPlayground(playground));
  },
  { rootMargin: '400px 0px' },
);
near.observe(playground);
