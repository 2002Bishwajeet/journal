// @vitest-environment happy-dom
/**
 * #1176, the list, sidebar and editor side: with useCanEdit() false the note list has no New
 * and no swipe to Trash, the sidebar can't make or change folders, and the cover, toggle
 * title and callout type can't change (from the editor's read-only flag, #1211). Rows and folders still open.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { NodeViewProps } from "@tiptap/react";
import { setCanEdit } from "@/hooks/useCanEdit";
import type { DocumentMetadata, Folder, NoteListEntry } from "@/types";

const mocks = vi.hoisted(() => ({ updateAttributes: vi.fn(), editorReadOnly: false }));

vi.mock("@/components/auth", () => ({
  useDotYouClientContext: () => ({ getRoot: () => "", getHostIdentity: () => "me.example" }),
}));
vi.mock("@/hooks/auth/useAuth", () => ({ useAuth: () => ({ getIdentity: () => "me.example" }) }));
vi.mock("@/hooks/useSyncService", () => ({ useSyncService: () => ({ sync: vi.fn(), pendingCount: 0 }) }));
vi.mock("@/hooks/useNotes", () => ({ useNotes: () => ({ togglePin: { mutate: vi.fn() } }) }));
vi.mock("@/hooks/useDeviceType", () => ({ useDeviceType: () => "desktop" }));
vi.mock("@/hooks/useIsDarkTheme", () => ({ useIsDarkTheme: () => false }));
vi.mock("@/components/modals", () => ({ ConfirmDialog: () => null, ShareFolderDialog: () => null, SignOutConfirmDialog: () => null }));
vi.mock("@/components/license/License", () => ({ TrialChip: () => null }));
vi.mock("@/components/editor/EditorContext", () => ({
  useEditorContext: () => ({ cover: null, readOnly: mocks.editorReadOnly, setCoverFromFile: vi.fn(), removeCover: vi.fn(), setCoverPosition: vi.fn() }),
}));
vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  NodeViewContent: () => null,
}));

import NoteList from "@/components/layout/NoteList";
import Sidebar from "@/components/layout/Sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NoteCover } from "@/components/editor/NoteCover";
import { ToggleNodeView } from "@/components/editor/nodes/ToggleNodeView";
import { CalloutNodeView } from "@/components/editor/nodes/CalloutNodeView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

let root: Root;
let container: HTMLDivElement;

async function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <MemoryRouter>
        <TooltipProvider>{node}</TooltipProvider>
      </MemoryRouter>,
    ),
  );
}

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setCanEdit(true);
  mocks.editorReadOnly = false;
  vi.clearAllMocks();
});

const byLabel = (name: string) =>
  [...container.querySelectorAll("button, textarea, input")].find(
    (el) => (el.getAttribute("aria-label") ?? el.textContent?.trim()) === name,
  ) as HTMLButtonElement | undefined;

const NOW = new Date().toISOString();
const note = { docId: "n1", title: "Packing", preview: "", metadata: { folderId: "f1", timestamps: { created: NOW, modified: NOW } } } as unknown as NoteListEntry;

function list(onCreateNote = vi.fn(), notes: NoteListEntry[] = [note]) {
  return (
    <NoteList
      notes={notes}
      selectedNoteId={null}
      onSelectNote={vi.fn()}
      onCreateNote={onCreateNote}
      onDeleteNote={vi.fn()}
      onShareNote={vi.fn()}
    />
  );
}

describe("note list", () => {
  it("has no New, and its hidden swipe Trash button is disabled; rows still open", async () => {
    setCanEdit(false);
    await render(list());
    expect(byLabel("New")).toBeUndefined();
    expect(byLabel("Move to Trash")?.disabled).toBe(true);
    expect(container.textContent).toContain("Packing");
  });

  it("an empty list has no Create your first note", async () => {
    setCanEdit(false);
    await render(list(vi.fn(), []));
    expect(container.textContent).toContain("No notes yet");
    expect(byLabel("Create your first note")).toBeUndefined();
  });

  it("keeps New while the app can edit", async () => {
    await render(list());
    expect(byLabel("New")).toBeDefined();
    expect(byLabel("Move to Trash")?.disabled).toBe(false);
  });
});

const folders = [
  { id: "main-id", name: "Main" },
  { id: "f1", name: "Projects" },
] as unknown as Folder[];

function sidebar() {
  return (
    <Sidebar
      folders={folders}
      selectedFolderId="f1"
      onSelectFolder={vi.fn()}
      onCreateFolder={vi.fn()}
      onDeleteFolder={vi.fn()}
      onRenameFolder={vi.fn()}
      onSearch={vi.fn()}
      onSettings={vi.fn()}
      onLogout={vi.fn()}
      sharedPull={{ canPull: false, isRefreshing: false, refresh: vi.fn() } as never}
    />
  );
}

describe("sidebar", () => {
  it("has no New folder or folder options, and the folders still list", async () => {
    setCanEdit(false);
    await render(sidebar());
    expect(byLabel("New folder")).toBeUndefined();
    expect(byLabel("Folder options")).toBeUndefined();
    expect(container.textContent).toContain("Projects");
  });

  it("keeps them while the app can edit", async () => {
    await render(sidebar());
    expect(byLabel("New folder")).toBeDefined();
    expect(byLabel("Folder options")).toBeDefined();
  });
});

describe("editor", () => {
  const meta = { title: "Packing", timestamps: {} } as unknown as DocumentMetadata;

  it("a read-only note has no Add cover", async () => {
    mocks.editorReadOnly = true;
    await render(<NoteCover metadata={meta} />);
    expect(byLabel("Add cover")).toBeUndefined();
  });

  it("an editable note keeps Add cover", async () => {
    await render(<NoteCover metadata={meta} />);
    expect(byLabel("Add cover")).toBeDefined();
  });

  const view = (summary: string) =>
    ({ editor: { isEditable: true }, node: { attrs: { summary, variant: "info" } }, updateAttributes: mocks.updateAttributes }) as unknown as NodeViewProps;

  // The editor's read-only flag, not useCanEdit(): a note shared view-only (#897) is read-only on the web too (#1211).
  it("a toggle's title can't change, and it still opens and closes", async () => {
    mocks.editorReadOnly = true;
    await render(<ToggleNodeView {...view("Details")} />);
    const input = byLabel("Toggle title") as unknown as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    await act(async () => byLabel("Collapse")!.click());
    expect(byLabel("Expand")).toBeDefined();
  });

  it("a callout shows its icon with no type picker", async () => {
    mocks.editorReadOnly = true;
    await render(<CalloutNodeView {...view("")} />);
    expect(byLabel("Callout type: info")).toBeUndefined();
  });

  it("a toggle's title still changes while the editor is editable", async () => {
    await render(<ToggleNodeView {...view("Details")} />);
    expect((byLabel("Toggle title") as unknown as HTMLInputElement).readOnly).toBe(false);
  });

  it("a callout keeps its type picker while the app can edit", async () => {
    await render(<CalloutNodeView {...view("")} />);
    expect(byLabel("Callout type: info")).toBeDefined();
  });
});
