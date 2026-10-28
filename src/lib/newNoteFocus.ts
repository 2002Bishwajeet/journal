// A note that "New" just created gets its title focused when its screen opens on a phone (#825).
// Kept here, not in the route's history state, so a reload or a Back to the note does not focus again.
let pendingDocId: string | null = null;

export function markNewNote(docId: string): void {
  pendingDocId = docId;
}

/** True once for the note `markNewNote` named. */
export function takeNewNote(docId: string): boolean {
  if (pendingDocId !== docId) return false;
  pendingDocId = null;
  return true;
}
