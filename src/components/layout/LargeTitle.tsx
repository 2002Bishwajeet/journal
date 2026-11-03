import type { ReactNode, Ref } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Phone and tablet (#830): the iOS large title, 34 px at the top of the scroll area. It scrolls
 * with the content; useLargeTitle tells the bar when it has gone, so BarTitle can show.
 */
export function LargeTitle({ titleRef, children }: { titleRef: Ref<HTMLHeadingElement>; children: ReactNode }) {
  return (
    <h2
      ref={titleRef}
      data-large-title
      className="truncate px-4 pt-1 pb-2 text-[34px] leading-[41px] font-bold tracking-[0.01em] text-foreground"
    >
      {children}
    </h2>
  );
}

/**
 * The bar's small title, centred, shown once the large title has scrolled under the bar.
 * Hidden from screen readers: the large title is the heading.
 */
export function BarTitle({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <span
      aria-hidden
      data-bar-title
      data-shown={show || undefined}
      className={cn(
        "pointer-events-none absolute inset-x-24 truncate text-center text-[17px] font-semibold text-foreground transition-[opacity,visibility] duration-150 ease-out",
        show ? "visible opacity-100" : "invisible opacity-0",
      )}
    >
      {children}
    </span>
  );
}

/** A centred icon, a one-line title and a short sentence; clear of the New note button and the tab bar. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 pt-6 pb-[calc(1.5rem+var(--fab-clearance,0px))]">
      <div data-empty-state className="flex flex-col items-center text-center">
        <Icon className="mb-3 size-12 text-muted-foreground/60" strokeWidth={1.5} aria-hidden />
        <p className="text-xl font-semibold text-foreground">{title}</p>
        <p className="mt-1 max-w-xs text-[15px] text-muted-foreground">{description}</p>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  );
}
