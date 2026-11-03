// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { NoteListPane } from "@/components/layout/NoteListPane";
import { PSEUDO_FOLDERS } from "@/lib/homebase/config";

vi.mock("@/components/layout/NoteList", () => ({
  default: ({ trailing }: { trailing?: React.ReactNode }) => <div>{trailing}</div>,
}));
vi.mock("@/components/layout/SyncStatus", () => ({ SyncStatus: () => null }));
vi.mock("@/components/layout/HiddenNotesView", () => ({ HiddenNotesView: () => null }));

let root: Root;
let container: HTMLDivElement;

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const sharedPull = (canPull: boolean, refresh = vi.fn()) => ({
  canPull,
  isRefreshing: false,
  refresh,
  pullOwnerNow: vi.fn(),
});

async function renderPane(opts: { isPhone: boolean; folderId: string; canPull: boolean; refresh?: () => void }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(
    <MemoryRouter>
      <NoteListPane
        isDesktop={false}
        isTablet={false}
        isPhone={opts.isPhone}
        folderId={opts.folderId}
        onOpenSidebar={vi.fn()}
        isManagementView={false}
        isListVisibleOnMobile
        inFocusMode={false}
        selectedTag={null}
        listNotes={[]}
        isListLoading={false}
        noteActions={{} as never}
        onShareNote={vi.fn()}
        onMoveToFolder={vi.fn()}
        onRemoveFromList={vi.fn()}
        sharedPull={sharedPull(opts.canPull, opts.refresh as never)}
      />
    </MemoryRouter>,
  ));
  return container.querySelector<HTMLButtonElement>("button[aria-label='Refresh shared notes']");
}

describe("Refresh shared notes on a phone", () => {
  it("sits in the Shared list header and pulls", async () => {
    const refresh = vi.fn();
    const button = await renderPane({ isPhone: true, folderId: PSEUDO_FOLDERS.shared, canPull: true, refresh });
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("is absent in other lists, off phones, and without permission", async () => {
    expect(await renderPane({ isPhone: true, folderId: "main", canPull: true })).toBeNull();
    await act(async () => root.unmount());
    container.remove();
    expect(await renderPane({ isPhone: false, folderId: PSEUDO_FOLDERS.shared, canPull: true })).toBeNull();
    await act(async () => root.unmount());
    container.remove();
    expect(await renderPane({ isPhone: true, folderId: PSEUDO_FOLDERS.shared, canPull: false })).toBeNull();
  });
});
