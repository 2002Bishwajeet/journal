declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

/** The React a `react` live block runs on, as the text of one script (#426). Built in vite.config.ts. */
declare module 'virtual:react-block-runtime' {
  const runtime: string;
  export default runtime;
}

/** A react block's Tailwind stylesheet, in Journal's theme (#427). Built in vite.config.ts. */
declare module 'virtual:react-block-tailwind' {
  const stylesheet: string;
  export default stylesheet;
}

/** Tailwind's theme.css, for the compiler of a react block's own classes (#559). Built in vite.config.ts. */
declare module 'virtual:react-block-tailwind-theme' {
  const css: string;
  export default css;
}

/** Recharts in Journal's theme for a react block, as the text of a script that sets window.Recharts (#427). */
declare module 'virtual:react-block-recharts' {
  const script: string;
  export default script;
}

/** lucide-react for a react block, as the text of a script that sets window.LucideReact (#427). */
declare module 'virtual:react-block-lucide' {
  const script: string;
  export default script;
}

/** Any other library a react block can import, as the text of a script that sets its global (REACT_BLOCK_LIBRARIES, #558). */
declare module 'virtual:react-block-*' {
  const script: string;
  export default script;
}

/** Installed only in e2e mode on an allowlisted test origin — see src/lib/e2e/testHooks.ts. */
interface JournalE2EHooks {
  /** Resolves once boot phase db-ready has fired and the boot splash has been replaced by the app UI. */
  ready(): Promise<void>;
  /** True while an edit is still queued for, or being written to, PGlite. */
  hasUnsavedEdits(): Promise<boolean>;
  /** Resolves once PGlite has flushed everything it committed to IndexedDB. */
  syncToDisk(): Promise<void>;
  /** Skips incoming invites until the page reloads, so a share arrives only through the shared pull (#732). */
  ignoreInvites(): void;
  /** Leaves 6 unsynced items, two of them with errors, for the Diagnostics spec (#800). */
  seedPendingSync(): Promise<void>;
  /** Deletes the signed-in identity's folders (with their notes), notes and invites whose name matches the regex source; returns the names. */
  deleteFilesNamed(namePattern: string): Promise<string[]>;
  /** Draws a 1200×630 link card JPEG, as src/lib/share/cardImage.ts's renderCardImage does. */
  renderCard(
    text: { title: string; excerpt?: string; author: string },
    cover?: { image: Blob; positionY: number },
  ): Promise<Blob>;
}

interface Window {
  readonly __journalE2E?: JournalE2EHooks;
  /** Dev-only debug handle, see src/lib/utils/memoryMonitor.ts. */
  memoryMonitor?: {
    start(intervalMs?: number): void;
    stop(): void;
    snapshot(): void;
  };
}
