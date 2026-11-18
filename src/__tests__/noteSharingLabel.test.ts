import { describe, it, expect } from "vitest";
import { noteSharingLabel } from "@/helpers/noteSharingLabel";

describe("noteSharingLabel", () => {
  it("says the note is on the feed when it has a feed post", () => {
    expect(noteSharingLabel({ feedPostId: "abc" })).toBe("On your feed");
  });
  it("shows only the feed label when the note is also public", () => {
    expect(noteSharingLabel({ feedPostId: "abc", isPublic: true })).toBe("On your feed");
  });
  it("says public link when public and not on the feed", () => {
    expect(noteSharingLabel({ isPublic: true })).toBe("Public link");
  });
  it("shows nothing when the note is neither", () => {
    expect(noteSharingLabel({})).toBeNull();
    expect(noteSharingLabel({ isPublic: false })).toBeNull();
  });
});
