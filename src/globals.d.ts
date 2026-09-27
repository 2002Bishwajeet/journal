declare const __APP_VERSION__: string;

/** Installed only in e2e mode on an allowlisted test origin — see src/lib/e2e/testHooks.ts. */
interface JournalE2EHooks {
  /** Resolves once boot phase db-ready has fired and the boot splash has been replaced by the app UI. */
  ready(): Promise<void>;
  /** Resolves once there is no queued sync work left (nothing pending to push or pull). */
  syncIdle(): Promise<void>;
}

interface Window {
  readonly __journalE2E?: JournalE2EHooks;
}
