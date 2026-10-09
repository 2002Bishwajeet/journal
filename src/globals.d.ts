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

/** Installed only in e2e mode on an allowlisted test origin — see src/lib/e2e/testHooks.ts. */
interface JournalE2EHooks {
  /** Resolves once boot phase db-ready has fired and the boot splash has been replaced by the app UI. */
  ready(): Promise<void>;
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

interface WindowEventMap {
  /** Dispatched by the AI slash commands, handled by AISuggestionOverlay. */
  'ai-slash-command': CustomEvent<{ action: string }>;
}
