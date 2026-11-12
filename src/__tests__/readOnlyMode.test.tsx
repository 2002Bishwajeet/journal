// @vitest-environment happy-dom
/**
 * #1176: once the native trial ends, useCanEdit() is false and every write entry point is gone
 * or does nothing, while reading and export keep working. Each case flips the store directly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { setCanEdit } from "@/hooks/useCanEdit";
import { OPEN_SETTINGS_EVENT } from "@/hooks/useSettingsOpener";
import type { NoteListEntry } from "@/types";

const mocks = vi.hoisted(() => ({
  openPaywall: vi.fn(),
  handleExport: vi.fn(),
  handleImport: vi.fn(),
  createNote: vi.fn(async () => ({ docId: "new", folderId: "main" })),
  createNoteWithContent: vi.fn(async () => ({ docId: "new", folderId: "main" })),
  createNoteFromMarkdownInDb: vi.fn(async () => ({ docId: "copy", folderId: "main" })),
  getPublicNote: vi.fn(async () => ({ title: "Shared", content: "Hi" })),
}));

vi.mock("@/lib/billing", () => ({ openPaywall: mocks.openPaywall }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div role="menu">{children}</div>,
  DropdownMenuItem: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) => (
    <button role="menuitem" onClick={onSelect}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/layout/NoteList", () => ({
  default: ({ emptyState }: { emptyState?: ReactNode }) => <div data-testid="list">{emptyState}</div>,
}));
vi.mock("@/components/layout/SyncStatus", () => ({ SyncStatus: () => null }));
// The empty editor's entrance animation only: happy-dom cancels it on unmount.
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  motion: { div: ({ children, className }: { children: ReactNode; className?: string }) => <div className={className}>{children}</div> },
  useReducedMotion: () => true,
}));
vi.mock("@/hooks/useImportExport", () => ({
  useImportExport: () => ({ isExporting: false, isImporting: false, handleExport: mocks.handleExport, handleImport: mocks.handleImport }),
}));
vi.mock("@/hooks/auth", () => ({ useAuth: () => ({ getIdentity: () => "frodo.example.com" }) }));
vi.mock("@/hooks/useNotes", () => ({
  useNotes: () => ({
    createNote: { mutateAsync: mocks.createNote },
    createNoteWithContent: { mutateAsync: mocks.createNoteWithContent },
  }),
}));
vi.mock("@/hooks/useFolders", () => ({
  useFolders: () => ({ get: { data: [] } }),
  resolveNoteFolderId: () => "main",
}));
vi.mock("@/lib/providers/ShareProvider", () => ({ shareProvider: { getPublicNote: mocks.getPublicNote } }));
vi.mock("@/lib/notes/createNote", () => ({ createNoteFromMarkdownInDb: mocks.createNoteFromMarkdownInDb }));

import { ReadOnlyBanner } from "@/components/license/ReadOnlyBanner";
import { NoteListPane } from "@/components/layout/NoteListPane";
import DataSection from "@/components/settings/sections/DataSection";
import EmptyEditorPage from "@/pages/EmptyEditorPage";
import ShareTargetPage from "@/pages/ShareTargetPage";
import CapturePage from "@/pages/CapturePage";
import SaveSharedPage from "@/pages/SaveSharedPage";
import { PSEUDO_FOLDERS } from "@/lib/homebase/config";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode, path = "/") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={node} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setCanEdit(true);
  vi.clearAllMocks();
});

const button = (name: string) =>
  [...container.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name);
const click = (el: Element | undefined) => act(async () => (el as HTMLElement).click());

const trashed = { docId: "t1", title: "Old", preview: "", metadata: { timestamps: { modified: "" } } } as unknown as NoteListEntry;

function pane(folderId: string, notes: NoteListEntry[] = []) {
  return (
    <NoteListPane
      isDesktop={false}
      isPhone={false}
      isTablet
      onOpenSidebar={vi.fn()}
      isManagementView={folderId === PSEUDO_FOLDERS.trash}
      isListVisibleOnMobile
      inFocusMode={false}
      folderId={folderId}
      selectedTag={null}
      viewLabel="Projects"
      listNotes={notes}
      isListLoading={false}
      noteActions={{ createAndOpen: vi.fn(), restoreFromTrash: vi.fn(), deleteForever: vi.fn(), emptyTrash: vi.fn() } as never}
      onShareNote={vi.fn()}
      onMoveToFolder={vi.fn()}
      onRemoveFromList={vi.fn()}
    />
  );
}

describe("ReadOnlyBanner", () => {
  it("shows nothing while the app can edit", async () => {
    await render(<ReadOnlyBanner />);
    expect(container.textContent).toBe("");
  });

  it("says why, opens the paywall and reaches export", async () => {
    setCanEdit(false);
    await render(<ReadOnlyBanner />);
    expect(container.textContent).toContain(
      "Your trial has ended. Your notes are read-only on this device. Unlock Journal to keep writing.",
    );
    await click(button("Unlock"));
    expect(mocks.openPaywall).toHaveBeenCalledTimes(1);

    const opened: string[] = [];
    const onOpen = (e: Event) => opened.push((e as CustomEvent<string>).detail);
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    await click(button("Export my notes"));
    window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
    expect(opened).toEqual(["data"]);
  });

  it("names no price, store or website", async () => {
    setCanEdit(false);
    await render(<ReadOnlyBanner />);
    expect(container.textContent).not.toMatch(/€|\$|24[.,]99|website|cloudx\.run|Dodo|App Store|Google Play/i);
  });
});

describe("note list pane", () => {
  it("an empty folder offers no New note, and the banner shows", async () => {
    setCanEdit(false);
    await render(pane("projects-id"));
    expect(button("New note in Projects")).toBeUndefined();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("read-only on this device");
  });

  it("Trash lists its notes with no Restore, Delete forever or Empty Trash", async () => {
    setCanEdit(false);
    await render(pane(PSEUDO_FOLDERS.trash, [trashed]));
    expect(container.textContent).toContain("Old");
    expect(button("Restore note")).toBeUndefined();
    expect(button("Delete forever")).toBeUndefined();
    // Empty Trash is in the header's More sheet on a tablet (the banner has its own More).
    const more = [...container.querySelectorAll('button[aria-label="More"]')];
    expect(more.filter((b) => !b.closest('[role="status"]'))).toEqual([]);
  });

  it("keeps everything while the app can edit", async () => {
    await render(pane(PSEUDO_FOLDERS.trash, [trashed]));
    expect(button("Restore note")).toBeDefined();
    expect(button("More")).toBeDefined();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});

describe("Settings → Data & storage", () => {
  it("has no import, and Export All Notes still exports", async () => {
    setCanEdit(false);
    await render(<DataSection />);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.textContent).not.toContain("Import Archive");
    const exportButton = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Export"));
    await click(exportButton);
    expect(mocks.handleExport).toHaveBeenCalledTimes(1);
  });
});

describe("new note entry points", () => {
  it("the empty editor offers no Create New Note", async () => {
    setCanEdit(false);
    await render(<EmptyEditorPage overrideFolderId="main" />);
    expect(button("Create New Note")).toBeUndefined();
  });

  it("the share target can't save", async () => {
    setCanEdit(false);
    await render(<ShareTargetPage />, "/share-target?title=Hi&text=there");
    expect(button("Save Note")?.disabled).toBe(true);
    expect(container.textContent).toContain("read-only on this device");
    await click(button("Save Note"));
    expect(mocks.createNoteWithContent).not.toHaveBeenCalled();
  });

  it("quick capture saves nothing on Cmd+Enter and says why", async () => {
    setCanEdit(false);
    await render(<CapturePage />);
    const field = container.querySelector("textarea")!;
    expect(field.readOnly).toBe(true);
    expect(field.placeholder).toContain("read-only on this device");
    await act(async () => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    });
    expect(mocks.createNoteWithContent).not.toHaveBeenCalled();
  });
});

describe("Save a copy of a shared note", () => {
  const link = "/save-shared?identity=author.example.com&file=4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34";

  it("makes no copy when read-only, and says why", async () => {
    setCanEdit(false);
    await render(<SaveSharedPage />, link);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("read-only on this device");
    expect(mocks.getPublicNote).not.toHaveBeenCalled();
    expect(mocks.createNoteFromMarkdownInDb).not.toHaveBeenCalled();
  });

  it("waits for the native answer before it copies", async () => {
    setCanEdit(undefined);
    await render(<SaveSharedPage />, link);
    expect(mocks.getPublicNote).not.toHaveBeenCalled();
    await act(async () => setCanEdit(true));
    await vi.waitFor(() => expect(mocks.createNoteFromMarkdownInDb).toHaveBeenCalledTimes(1));
  });
});
