/**
 * Closing a desktop window waits, 1.5 s at most, for its page to write the sealed unload
 * copies of its open notes (#1429, db_key.rs `on_close_requested`): sealing them is
 * asynchronous, so a pagehide alone could lose the last edits. The page answers
 * `close_flushed` once they're written, or failed to be.
 */
const FLUSH_BEFORE_CLOSE = 'journal://flush-before-close';

export async function installCloseFlush(): Promise<void> {
    try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const { invoke } = await import('@tauri-apps/api/core');
        await getCurrentWebviewWindow().listen(FLUSH_BEFORE_CLOSE, async () => {
            try {
                const { PGliteProvider } = await import('@/lib/yjs/provider');
                await PGliteProvider.saveAllBeforeClose();
            } finally {
                await invoke('plugin:journal-db-key|close_flushed');
            }
        });
    } catch (err) {
        // The window still closes, after the wait.
        console.warn('[closeFlush] A closing window won\'t wait for the unload copies:', err);
    }
}
