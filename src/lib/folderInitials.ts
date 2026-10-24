/**
 * Two characters for a folder's tile in the collapsed sidebar, so folders that share a
 * first letter still look different: "Master Thesis" -> "MT", "Main" -> "Ma".
 */
export function folderInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  // Array.from keeps an emoji or other astral character whole.
  const first = Array.from(words[0]);
  if (words.length > 1) return (first[0] + Array.from(words[1])[0]).toUpperCase();
  return first[0].toUpperCase() + (first[1] ?? "").toLowerCase();
}
