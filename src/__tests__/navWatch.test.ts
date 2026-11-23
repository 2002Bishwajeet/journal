// @vitest-environment happy-dom
/**
 * #1467: a navigation that never renders (a route stuck on a lazy chunk) is logged as
 * `nav-stuck <path>`, next to the database heartbeat's lines, so the two hangs can be told apart.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNavWatch, navRendered } from '@/lib/navWatch';

let error: ReturnType<typeof vi.spyOn>;

beforeAll(() => installNavWatch());

beforeEach(() => {
  vi.useFakeTimers();
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('navWatch', () => {
  it('logs a router navigation that has not rendered after 5 s', () => {
    history.pushState({ usr: null, key: 'k1', idx: 1 }, '', '/folder-1/note-1');
    vi.advanceTimersByTime(4_999);
    expect(error).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(error).toHaveBeenCalledWith('[db-health] nav-stuck /folder-1/note-1');
  });

  it('logs nothing once the location rendered', () => {
    history.replaceState({ usr: null, key: 'k2', idx: 1 }, '', '/folder-1');
    navRendered('k2');
    vi.advanceTimersByTime(10_000);
    expect(error).not.toHaveBeenCalled();
  });

  it('watches Back and Forward too', () => {
    dispatchEvent(new PopStateEvent('popstate', { state: { usr: null, key: 'k3', idx: 0 } }));
    vi.advanceTimersByTime(5_000);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('ignores history entries the router did not make', () => {
    history.replaceState(null, '', '#heading-1');
    vi.advanceTimersByTime(10_000);
    expect(error).not.toHaveBeenCalled();
  });
});
