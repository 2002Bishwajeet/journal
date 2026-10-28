import { cn } from "@/lib/utils";

/** The on-device assistant is experimental (#674); MCP agents are the recommended path. */
export const AGENTS_URL = "https://journal.cloudx.run/agents";

export function ExperimentalBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-2 py-0.5 font-sans text-[11px] font-medium leading-none tracking-normal text-amber-900 dark:bg-amber-400/15 dark:text-amber-300">
      Experimental
    </span>
  );
}

export function LocalAINote({ className }: { className?: string }) {
  return (
    <p className={cn("text-muted-foreground text-pretty", className)}>
      Runs entirely on this device. Slower and less capable than AI agents connected through MCP.{" "}
      <a
        href={AGENTS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-foreground underline decoration-muted-foreground/70 underline-offset-4 hover:decoration-current"
      >
        Set up an agent
      </a>
    </p>
  );
}
