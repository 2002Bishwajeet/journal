// @vitest-environment happy-dom
/** #1211: a read-only note (#897, #1176) shows its tags, with no way to add or remove one. */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DocumentMetadata } from "@/types";

vi.mock("@/hooks/useTags", () => ({ useTags: () => ({ tags: [], addTag: vi.fn(), removeTag: vi.fn() }) }));

import { TagInput } from "@/components/editor/TagInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

async function render(tags: string[], readOnly: boolean) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  const metadata = { title: "Packing", tags, timestamps: {} } as unknown as DocumentMetadata;
  await act(async () => root.render(<TagInput docId="n1" metadata={metadata} readOnly={readOnly} />));
}

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("TagInput", () => {
  it("lists a read-only note's tags with no input and no remove buttons", async () => {
    await render(["travel", "summer"], true);
    expect(container.textContent).toBe("travelsummer");
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("shows nothing for a read-only note without tags", async () => {
    await render([], true);
    expect(container.innerHTML).toBe("");
  });

  it("keeps the input and remove buttons while the note is editable", async () => {
    await render(["travel"], false);
    expect(container.querySelector("input")).not.toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
});
