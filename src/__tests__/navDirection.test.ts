// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { navigateBack } from "@/lib/navDirection";

describe("navigateBack", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete document.documentElement.dataset.nav;
  });

  it("marks the back direction during the navigation, then clears it", () => {
    vi.useFakeTimers();
    let during: string | undefined;
    const navigate = vi.fn(() => {
      during = document.documentElement.dataset.nav;
    });
    navigateBack(navigate as never, "/folder");
    expect(navigate).toHaveBeenCalledWith("/folder", { viewTransition: true });
    expect(during).toBe("back");
    vi.advanceTimersByTime(500);
    expect(document.documentElement.dataset.nav).toBeUndefined();
  });
});
