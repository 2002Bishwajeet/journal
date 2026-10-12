/**
 * The editor's debounced search-index write (note title, preview, metadata) lands in PGlite
 * 500 ms after an edit. Open editors register their timer ref here so the e2e hooks can tell
 * when every edit has reached the database (src/lib/e2e/testHooks.ts).
 */
type TimerRef = { readonly current: ReturnType<typeof setTimeout> | null };

const refs = new Set<TimerRef>();

export function registerPendingEditorWrite(ref: TimerRef): () => void {
    refs.add(ref);
    return () => {
        refs.delete(ref);
    };
}

export function hasPendingEditorWrites(): boolean {
    for (const ref of refs) if (ref.current !== null) return true;
    return false;
}
