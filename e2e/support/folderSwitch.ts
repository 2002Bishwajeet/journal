import type { CDPSession, Page } from '@playwright/test';
import { assertTestOrigin } from './origin-guard';

// Folder-switch measurement (#1219): from the tap on a folder to the first frame that
// shows its notes, plus what happened on the way (a loading or empty flash, long tasks,
// CDP layout/style/script time, how many note rows React rendered).

export interface SwitchSample {
  folder: string;
  /** Tap to the first animation frame after the folder's rows are in the DOM, in ms. */
  paintMs: number;
  /** "Loading..." or an empty state showed in the list before the rows. */
  flashed: boolean;
  longTasks: number;
  longTaskMs: number;
  layoutMs: number;
  styleMs: number;
  scriptMs: number;
  /** NoteItem renders (mounts and re-renders) in the 1 s after the tap. */
  rowRenders: number;
  /** NoteItem mounts in that window. */
  rowMounts: number;
}

/**
 * Installed before the app loads: counts NoteItem renders through React's devtools hook
 * (a row fiber is one whose props carry `note` and `onSwipeChange`; it rendered in a
 * commit when it is new or its hook list was rebuilt), and records long tasks.
 */
export async function installSwitchProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Fiber = {
      child: Fiber | null;
      sibling: Fiber | null;
      alternate: Fiber | null;
      memoizedProps: Record<string, unknown> | null;
      memoizedState: unknown;
    };
    const w = window as unknown as { __switchProbe: { renders: number; mounts: number; longTasks: PerformanceEntry[] } };
    w.__switchProbe = { renders: 0, mounts: 0, longTasks: [] };
    const walk = (f: Fiber | null) => {
      while (f) {
        const p = f.memoizedProps;
        if (p && typeof p === 'object' && 'note' in p && 'onSwipeChange' in p) {
          if (!f.alternate) { w.__switchProbe.mounts += 1; w.__switchProbe.renders += 1; }
          else if (f.memoizedState !== f.alternate.memoizedState) w.__switchProbe.renders += 1;
        }
        walk(f.child);
        f = f.sibling;
      }
    };
    (window as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      onCommitFiberRoot: (_id: number, root: { current: Fiber }) => walk(root.current.child),
      onCommitFiberUnmount: () => {},
      onPostCommitFiberRoot: () => {},
      checkDCE: () => {},
    };
    new PerformanceObserver((list) => w.__switchProbe.longTasks.push(...list.getEntries())).observe({ entryTypes: ['longtask'] });
  });
}

async function cdpMetrics(cdp: CDPSession): Promise<Record<string, number>> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

/**
 * Taps `open` (which navigates to folder `name`) and measures until the list shows rows
 * titled "<name> …". `listPane` selects the element the list renders in.
 */
export async function measureSwitch(
  page: Page,
  cdp: CDPSession,
  name: string,
  open: () => Promise<void>,
  listPane = '[data-pane="note-list"]',
): Promise<SwitchSample> {
  await assertTestOrigin(page);
  await page.evaluate(({ name, listPane }) => {
    const w = window as unknown as Record<string, unknown> & { __switchProbe: { renders: number; mounts: number } };
    w.__switchProbe.renders = 0;
    w.__switchProbe.mounts = 0;
    const state = { t0: 0, flashed: false, paint: 0 };
    w.__switch = state;
    document.addEventListener('pointerdown', () => { state.t0 = performance.now(); }, { capture: true, once: true });
    const check = () => {
      if (!state.t0 || state.paint) return;
      const pane = document.querySelector(listPane);
      if (!pane) return;
      const first = pane.querySelector('[data-testid="note-row"]');
      if (first?.textContent?.includes(`${name} `)) {
        obs.disconnect();
        requestAnimationFrame(() => { state.paint = performance.now(); });
        return;
      }
      const text = pane.textContent ?? '';
      if (text.includes('Loading...') || text.includes('No notes')) state.flashed = true;
    };
    const obs = new MutationObserver(check);
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  }, { name, listPane });
  const before = await cdpMetrics(cdp);
  await open();
  await page.waitForFunction(() => (window as unknown as { __switch: { paint: number } }).__switch.paint > 0, null, { timeout: 30_000 });
  // Fixed window on purpose: trailing live-query emissions after the first paint are part
  // of what a switch costs, and nothing observable marks their end.
  await page.waitForTimeout(1000);
  const after = await cdpMetrics(cdp);
  const probe = await page.evaluate(() => {
    const w = window as unknown as {
      __switch: { t0: number; paint: number; flashed: boolean };
      __switchProbe: { renders: number; mounts: number; longTasks: PerformanceEntry[] };
    };
    const tasks = w.__switchProbe.longTasks.filter((t) => t.startTime >= w.__switch.t0);
    return {
      paintMs: w.__switch.paint - w.__switch.t0,
      flashed: w.__switch.flashed,
      longTasks: tasks.length,
      longTaskMs: tasks.reduce((s, t) => s + t.duration, 0),
      rowRenders: w.__switchProbe.renders,
      rowMounts: w.__switchProbe.mounts,
    };
  });
  const d = (k: string) => Math.round(((after[k] ?? 0) - (before[k] ?? 0)) * 1000);
  return {
    folder: name,
    ...probe,
    paintMs: Math.round(probe.paintMs),
    longTaskMs: Math.round(probe.longTaskMs),
    layoutMs: d('LayoutDuration'),
    styleMs: d('RecalcStyleDuration'),
    scriptMs: d('ScriptDuration'),
  };
}
