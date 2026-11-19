import type { ComponentProps } from "react";
import { ChevronDown } from "lucide-react";

/**
 * A native select drawn like the app's Input: its own chevron in reserved right padding,
 * and one width for every row, so no label runs under the arrow and the column lines up.
 */
export function SettingsSelect(props: ComponentProps<"select">) {
  return (
    <div className="relative w-40 shrink-0">
      <select
        {...props}
        className="h-11 md:h-9 w-full appearance-none rounded-md border border-border bg-background pl-3 pr-8 text-base pointer-fine:text-sm text-foreground shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
      />
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}
