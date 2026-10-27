// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { NoteListPane } from "@/components/layout/NoteListPane";

vi.mock("@/components/layout/NoteList", () => ({
  default: ({ onBack, backLabel }: { onBack?: () => void; backLabel?: string }) => (
    <div>{onBack && <button onClick={onBack}>{backLabel ?? "Back to notes"}</button>}</div>
  ),
}));
vi.mock("@/components/layout/SyncStatus", () => ({ SyncStatus: () => null }));
vi.mock("@/components/layout/HiddenNotesView", () => ({ HiddenNotesView: () => null }));

let root: Root;
let container: HTMLDivElement;

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderPane(flags: { isDesktop: boolean; isTablet: boolean }) {
  const onOpenSidebar = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(
    <MemoryRouter>
      <NoteListPane
        {...flags}
        isPhone={false}
        onOpenSidebar={onOpenSidebar}
        isManagementView={false}
        isListVisibleOnMobile={false}
        inFocusMode={false}
        selectedTag={null}
        listNotes={[]}
        isListLoading={false}
        noteActions={{} as never}
        onShareNote={vi.fn()}
        onMoveToFolder={vi.fn()}
        onMarkCollaborative={vi.fn()}
      />
    </MemoryRouter>,
  ));
  return { pane: container.querySelector("[data-pane=note-list]")!, onOpenSidebar };
}

describe("NoteListPane on a tablet (#832)", () => {
  it("is a 320 px column beside the editor, not a full-screen pane", async () => {
    const { pane } = await renderPane({ isDesktop: false, isTablet: true });
    expect(pane.className).toContain("w-80");
    expect(pane.className).toContain("static");
    expect(pane.className).not.toContain("hidden");
  });

  it("opens the folders from the header's leading button", async () => {
    const { onOpenSidebar } = await renderPane({ isDesktop: false, isTablet: true });
    const button = [...container.querySelectorAll("button")].find((b) => b.textContent === "Show folders")!;
    await act(async () => button.click());
    expect(onOpenSidebar).toHaveBeenCalledTimes(1);
  });

  it("keeps the 256 px column on desktop, with no leading button", async () => {
    const { pane } = await renderPane({ isDesktop: true, isTablet: false });
    expect(pane.className).toContain("w-64");
    expect(container.querySelector("button")).toBeNull();
  });
});
