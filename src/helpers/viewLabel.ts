import { PSEUDO_FOLDERS } from "@/lib/homebase/config";

/** The name of the list a route shows: a tag as "#work", Trash, Archive, Shared or a folder's name. */
export function viewLabel(
  folderId: string | undefined,
  tag: string | null,
  folders: ReadonlyArray<{ id: string; name: string }>,
): string | undefined {
  if (tag) return `#${tag}`;
  if (folderId === PSEUDO_FOLDERS.trash) return "Trash";
  if (folderId === PSEUDO_FOLDERS.archive) return "Archive";
  if (folderId === PSEUDO_FOLDERS.shared) return "Shared";
  return folders.find((f) => f.id === folderId)?.name;
}
