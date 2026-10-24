import { describe, it, expect } from "vitest";
import { folderInitials } from "@/lib/folderInitials";

describe("folderInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(folderInitials("Master Thesis")).toBe("MT");
    expect(folderInitials("gym stuffs and more")).toBe("GS");
  });

  it("takes the first two letters of a one-word name", () => {
    expect(folderInitials("Main")).toBe("Ma");
    expect(folderInitials("HABITS")).toBe("Ha");
  });

  it("tells apart names that share a first letter", () => {
    expect(folderInitials("Health")).not.toBe(folderInitials("Habits"));
  });

  it("handles one-character, padded, empty and emoji names", () => {
    expect(folderInitials("X")).toBe("X");
    expect(folderInitials("  Work  ")).toBe("Wo");
    expect(folderInitials("   ")).toBe("?");
    expect(folderInitials("🚀 Launch")).toBe("🚀L");
  });
});
