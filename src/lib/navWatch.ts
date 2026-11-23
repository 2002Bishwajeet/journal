import { appendDiagnostic } from './db/dbHealth';

/**
 * A navigation that never renders (#1467): React keeps the old screen while a route suspends,
 * so a note or folder that "doesn't open" is either a stuck route (a lazy chunk the app's
 * asset server never sends) or a stuck database. This tells them apart in the same log as the
 * database's heartbeat: a router navigation (its history entry has React Router's `key` and
 * `idx`) whose location hasn't rendered within 5 s writes `nav-stuck <path>`.
 */
export const NAV_STUCK_MS = 5_000;

let pending: { key: string; timer: ReturnType<typeof setTimeout> } | null = null;

function navigated(state: unknown): void {
  const { key, idx } = (state ?? {}) as { key?: unknown; idx?: unknown };
  if (typeof key !== 'string' || typeof idx !== 'number') return;
  if (pending) clearTimeout(pending.timer);
  const path = location.pathname;
  pending = {
    key,
    timer: setTimeout(() => {
      pending = null;
      appendDiagnostic(`nav-stuck ${path}`);
    }, NAV_STUCK_MS),
  };
}

/** Watches the router's navigations: pushState and replaceState (navigate()), and Back and Forward. */
export function installNavWatch(): void {
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      original.apply(this, args);
      navigated(args[0]);
    };
  }
  window.addEventListener('popstate', (event) => navigated(event.state));
}

/** The location with this key has rendered (useNavWatch). */
export function navRendered(key: string): void {
  if (pending?.key !== key) return;
  clearTimeout(pending.timer);
  pending = null;
}
