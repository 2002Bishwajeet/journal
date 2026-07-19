/**
 * Teardown-time flush for the editor's debounced server save.
 *
 * Content edits reach the server only through EditorProvider's 2s-debounced
 * save (they are never marked sync_status='pending', so the periodic sync
 * skips them). When the editor unmounts — and note switches unmount it, since
 * it's keyed by noteId — a still-pending save would be cancelled, so the last
 * keystrokes live in PGlite but never get pushed.
 *
 * This flushes that pending save on teardown. The push must happen only AFTER
 * destroy() finishes: destroy() compacts the local updates (delete-then-rewrite
 * in PGlite), and the server push re-reads PGlite — reading mid-compaction can
 * catch the empty window and clobber the note on the server.
 */
type TeardownProvider = {
    getFullState(): Uint8Array;
    destroy(): Promise<void>;
};

export function flushPendingSaveOnTeardown(
    provider: TeardownProvider,
    hasPendingSave: boolean,
    onSave: ((blob: Uint8Array) => void) | undefined,
): void {
    if (!hasPendingSave || !onSave) {
        void provider.destroy();
        return;
    }
    // Capture the latest state while the Y.Doc is still alive, then push once
    // compaction has settled.
    const finalState = provider.getFullState();
    void provider.destroy().then(() => onSave(finalState));
}
