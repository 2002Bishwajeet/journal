// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Trash2 } from "lucide-react";
import type { ContextMenuItemConfig } from "@/components/ui/context-menu-wrapper";
import { NoteListPane } from "@/components/layout/NoteListPane";
import { HiddenNotesView } from "@/components/layout/HiddenNotesView";
import { useLargeTitle } from "@/hooks/useLargeTitle";
import { PSEUDO_FOLDERS } from "@/lib/homebase/config";
import type { NoteListEntry } from "@/types";

// Phone and tablet home and list screens (#830): large titles, empty states, Empty Trash in a sheet.

vi.mock("@/components/layout/NoteList", () => ({
  default: ({ emptyState }: { emptyState?: ReactNode }) => <div data-testid="list">{emptyState ?? "default empty"}</div>,
}));
vi.mock("@/components/layout/SyncStatus", () => ({ SyncStatus: () => null }));
vi.mock("@/components/ui/action-sheet", () => ({
  // Closing runs onCloseAutoFocus, as Radix does once the sheet has gone.
  ActionSheet: ({ open, items, onCloseAutoFocus }: { open: boolean; items: ContextMenuItemConfig[]; onCloseAutoFocus?: (e: Event) => void }) =>
    open ? (
      <div role="menu">
        {items.map((i) => (
          <button key={i.label} role="menuitem" disabled={i.disabled} onClick={() => { i.action(); onCloseAutoFocus?.(new Event("focus")); }}>{i.label}</button>
        ))}
      </div>
    ) : null,
}));
vi.mock("@/components/modals", () => ({
  ConfirmDialog: ({ isOpen, title, confirmText, onConfirm }: { isOpen: boolean; title: string; confirmText: string; onConfirm: () => void }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onConfirm}>{confirmText}</button>
      </div>
    ) : null,
}));

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
}

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const buttons = () => [...container.querySelectorAll("button")];
const button = (name: string) => buttons().find((b) => (b.getAttribute("aria-label") ?? b.textContent) === name);
const click = (el: Element | undefined) => act(async () => (el as HTMLElement).click());

function pane(props: { isDesktop?: boolean; folderId?: string; selectedTag?: string | null; viewLabel?: string; createAndOpen?: () => void }) {
  return (
    <NoteListPane
      isDesktop={props.isDesktop ?? false}
      isPhone={!props.isDesktop}
      isTablet={false}
      onOpenSidebar={vi.fn()}
      isManagementView={false}
      isListVisibleOnMobile
      inFocusMode={false}
      folderId={props.folderId}
      selectedTag={props.selectedTag ?? null}
      viewLabel={props.viewLabel}
      listNotes={[]}
      isListLoading={false}
      noteActions={{ createAndOpen: props.createAndOpen ?? vi.fn() } as never}
      onShareNote={vi.fn()}
      onMoveToFolder={vi.fn()}
      onRemoveFromList={vi.fn()}
    />
  );
}

describe("list empty states on a phone (#830)", () => {
  it("an empty folder names it and its New note button creates the note there", async () => {
    const createAndOpen = vi.fn();
    await render(pane({ folderId: "projects-id", viewLabel: "Projects", createAndOpen }));
    expect(container.textContent).toContain("No notes in Projects");
    await click(button("New note in Projects"));
    expect(createAndOpen).toHaveBeenCalledWith("projects-id");
  });

  it("Shared explains what it holds and offers no New", async () => {
    await render(pane({ folderId: PSEUDO_FOLDERS.shared, viewLabel: "Shared" }));
    expect(container.textContent).toContain("Notes others share with you appear here.");
    expect(container.querySelector("[data-empty-state] button")).toBeNull();
  });

  it("a tag with no notes offers no New", async () => {
    await render(pane({ selectedTag: "work", viewLabel: "#work" }));
    expect(container.textContent).toContain("No notes tagged #work");
    expect(container.querySelector("[data-empty-state] button")).toBeNull();
  });

  it("desktop keeps its own empty list", async () => {
    await render(pane({ isDesktop: true, folderId: "projects-id", viewLabel: "Projects" }));
    expect(container.textContent).toBe("default empty");
  });
});

const note = { docId: "n1", title: "Old note", preview: "" } as NoteListEntry;

function trash(props: { compact: boolean; notes?: NoteListEntry[]; onEmpty?: () => void }) {
  return (
    <HiddenNotesView
      title="Trash"
      notes={props.notes ?? [note]}
      emptyIcon={Trash2}
      emptyLabel="Trash is empty"
      emptyDescription="Deleted notes stay here until you empty Trash."
      rowActions={[]}
      headerAction={{ label: "Empty Trash", onClick: props.onEmpty ?? vi.fn(), confirm: { title: "Empty Trash?", description: "" } }}
      compact={props.compact}
      onBack={props.compact ? vi.fn() : undefined}
    />
  );
}

describe("Trash on a phone (#830)", () => {
  it("has a large title and keeps Empty Trash out of the title row", async () => {
    await render(trash({ compact: true }));
    expect(container.querySelector("[data-large-title]")?.textContent).toBe("Trash");
    expect(button("Empty Trash")).toBeUndefined();
    expect(button("More")).toBeDefined();
  });

  it("empties Trash from More, only after the confirm", async () => {
    const onEmpty = vi.fn();
    await render(trash({ compact: true, onEmpty }));
    await click(button("More"));
    await click(container.querySelector("[role=menuitem]")!);
    expect(onEmpty).not.toHaveBeenCalled();
    const confirm = container.querySelector("[role=dialog][aria-label='Empty Trash?']");
    expect(confirm).not.toBeNull();
    await click(confirm!.querySelector("button")!);
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });

  it("disables Empty Trash and explains Trash when it is empty", async () => {
    await render(trash({ compact: true, notes: [] }));
    expect(container.querySelector("[data-empty-state]")?.textContent).toContain("until you empty Trash");
    await click(button("More"));
    expect((container.querySelector("[role=menuitem]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("desktop keeps the header button, now behind the confirm", async () => {
    const onEmpty = vi.fn();
    await render(trash({ compact: false, onEmpty }));
    expect(container.querySelector("[data-large-title]")).toBeNull();
    await click(button("Empty Trash"));
    expect(onEmpty).not.toHaveBeenCalled();
    await click(container.querySelector("[role=dialog] button")!);
    expect(onEmpty).toHaveBeenCalledTimes(1);
  });
});

describe("useLargeTitle (#830)", () => {
  let fire: (isIntersecting: boolean) => void;
  const observe = vi.fn();
  const disconnect = vi.fn();

  beforeEach(() => {
    observe.mockClear();
    disconnect.mockClear();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          fire = (isIntersecting) => cb([{ isIntersecting } as IntersectionObserverEntry], this as never);
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
  });

  function Probe({ enabled }: { enabled: boolean }) {
    const { ref, collapsed } = useLargeTitle(enabled);
    return <h2 ref={ref} data-collapsed={collapsed} />;
  }
  const collapsed = () => container.querySelector("h2")!.dataset.collapsed;

  it("collapses once the title leaves its scroll area, and expands when it is back", async () => {
    await render(<Probe enabled />);
    expect(observe).toHaveBeenCalledTimes(1);
    expect(collapsed()).toBe("false");
    await act(async () => fire(false));
    expect(collapsed()).toBe("true");
    await act(async () => fire(true));
    expect(collapsed()).toBe("false");
  });

  it("observes nothing when off (desktop)", async () => {
    await render(<Probe enabled={false} />);
    expect(observe).not.toHaveBeenCalled();
    expect(collapsed()).toBe("false");
  });
});
