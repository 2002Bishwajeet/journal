// @vitest-environment happy-dom
/**
 * #1014, #1116: the capture window's save and discard rules in the desktop app, which the
 * hotkey and the macOS menu bar icon both open. The native window is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setCanEdit } from "@/hooks/useCanEdit";
import { MAIN_FOLDER_ID } from "@/lib/homebase";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  hide: vi.fn(async () => {}),
  createNoteWithContent: vi.fn(async () => ({ docId: "new", folderId: "main" })),
}));

vi.mock("@premium", () => ({ quickCapture: { state: vi.fn(), setShortcut: vi.fn(), hide: mocks.hide } }));
vi.mock("@/hooks/useNotes", () => ({
  useNotes: () => ({ createNoteWithContent: { mutateAsync: mocks.createNoteWithContent } }),
}));

import CapturePage from "@/pages/CapturePage";

let container: HTMLDivElement;
let root: Root;

const field = () => container.querySelector("textarea")!;

async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field(), text);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(key: string, metaKey = false) {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key, metaKey, bubbles: true }));
  });
}

beforeEach(async () => {
  mocks.hide.mockClear();
  mocks.createNoteWithContent.mockClear();
  window.__JOURNAL_NATIVE__ = { platform: "macos", plugins: ["journal-capture"] };
  setCanEdit(true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<CapturePage />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete (window as { __JOURNAL_NATIVE__?: unknown }).__JOURNAL_NATIVE__;
});

describe("CapturePage in the desktop app", () => {
  it("Cmd+Return makes a note in Main, first line as the title, then clears and hides", async () => {
    await type("Buy milk\nand eggs");
    await press("Enter", true);
    expect(mocks.createNoteWithContent).toHaveBeenCalledWith({
      title: "Buy milk",
      content: "and eggs",
      folderId: MAIN_FOLDER_ID,
    });
    expect(field().value).toBe("");
    expect(mocks.hide).toHaveBeenCalledTimes(1);
  });

  it("Esc hides the window and keeps the draft for the next open", async () => {
    await type("Half a thought");
    await press("Escape");
    expect(mocks.hide).toHaveBeenCalledTimes(1);
    expect(mocks.createNoteWithContent).not.toHaveBeenCalled();
    expect(field().value).toBe("Half a thought");
  });

  it("does nothing for blank text and keeps the window open", async () => {
    await type("  \n ");
    await press("Enter", true);
    expect(mocks.createNoteWithContent).not.toHaveBeenCalled();
    expect(mocks.hide).not.toHaveBeenCalled();
  });

  it("puts the focus back in the text when the window is shown again", async () => {
    field().blur();
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(document.activeElement).toBe(field());
  });
});
