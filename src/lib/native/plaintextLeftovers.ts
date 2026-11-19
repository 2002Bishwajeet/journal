import { RECENT_SEARCHES_KEY, TABS_STORAGE_KEY, readJson, removeKey, writeJson } from '@/lib/storage';
import { sealPlaintextCopies } from '@/lib/yjs/unsavedEdits';

/**
 * The native app writes no note text outside its encrypted database (#1429). At boot this
 * removes what older builds left in localStorage: the open tabs' titles (useTabRouting fills
 * them in from the notes), the recent searches, and the plaintext unload copies of edits,
 * which are sealed once the database's key is in (they stay readable until then).
 */
export function removePlaintextLeftovers(): void {
    const tabs = readJson<{ openTabs?: { title?: string }[] }>(TABS_STORAGE_KEY);
    if (Array.isArray(tabs?.openTabs) && tabs.openTabs.some((tab) => tab?.title)) {
        writeJson(TABS_STORAGE_KEY, { ...tabs, openTabs: tabs.openTabs.map((tab) => ({ ...tab, title: '' })) });
    }
    removeKey(RECENT_SEARCHES_KEY);
    void sealPlaintextCopies();
}
