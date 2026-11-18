import type { DocumentMetadata } from "@/types";

/** Where a note is out in the world, for its note list row (#1413). The feed implies public, so it wins. */
export function noteSharingLabel(metadata: Pick<DocumentMetadata, "feedPostId" | "isPublic">): "On your feed" | "Public link" | null {
  if (metadata.feedPostId) return "On your feed";
  return metadata.isPublic ? "Public link" : null;
}
