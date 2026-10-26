// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { routeRendered, slideNavigate } from "@/lib/navDirection";

type Update = () => Promise<void>;

// A stand-in for document.startViewTransition that runs the update on demand.
function stubViewTransition() {
  const updates: Update[] = [];
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  document.startViewTransition = vi.fn((update: Update) => {
    updates.push(update);
    return { finished } as ViewTransition;
  }) as never;
  return { updates, finish: () => finish() };
}

const phone = (matches: boolean) =>
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches } as MediaQueryList);

describe("slideNavigate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    delete document.documentElement.dataset.nav;
  });

  it("navigates inside a view transition, marked back, and ends it when the route renders", async () => {
    phone(false);
    const vt = stubViewTransition();
    const go = vi.fn(() => expect(document.documentElement.dataset.nav).toBe("back"));
    slideNavigate("back", go);
    expect(go).not.toHaveBeenCalled();

    let done = false;
    const update = vt.updates[0]().then(() => (done = true));
    expect(go).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(done).toBe(false);
    routeRendered();
    await update;
    expect(done).toBe(true);

    vt.finish();
    await new Promise((r) => setTimeout(r));
    expect(document.documentElement.dataset.nav).toBeUndefined();
  });

  it("does not mark a forward slide", () => {
    phone(false);
    const vt = stubViewTransition();
    slideNavigate("forward", () => {});
    void vt.updates[0]();
    expect(document.documentElement.dataset.nav).toBeUndefined();
  });

  it("lets the old screen go if the location never renders", async () => {
    vi.useFakeTimers();
    phone(false);
    const vt = stubViewTransition();
    slideNavigate("forward", () => {});
    const update = vt.updates[0]();
    vi.advanceTimersByTime(500);
    await expect(update).resolves.toBeUndefined();
  });

  it("navigates without a transition on desktop, with reduced motion, or without view transitions", () => {
    phone(true);
    const vt = stubViewTransition();
    const go = vi.fn();
    slideNavigate("back", go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(vt.updates).toHaveLength(0);

    vi.restoreAllMocks();
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    phone(false);
    slideNavigate("back", go);
    expect(go).toHaveBeenCalledTimes(2);
    expect(document.documentElement.dataset.nav).toBeUndefined();
  });
});
