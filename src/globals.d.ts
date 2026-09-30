declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

/** Installed only in e2e mode on an allowlisted test origin — see src/lib/e2e/testHooks.ts. */
interface JournalE2EHooks {
  /** Resolves once boot phase db-ready has fired and the boot splash has been replaced by the app UI. */
  ready(): Promise<void>;
  /** Local notes, folders and images not yet pushed to Homebase. */
  pendingSyncCount(): Promise<number>;
}

interface Window {
  readonly __journalE2E?: JournalE2EHooks;
}
