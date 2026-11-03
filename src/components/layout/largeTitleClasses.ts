import { cn } from "@/lib/utils";

/** The 44 px bar above a large title: its hairline shows once the large title has scrolled under it. */
export const largeTitleBarClass = (collapsed: boolean) =>
  cn("relative flex h-11 shrink-0 items-center border-b px-2 transition-colors", !collapsed && "border-transparent");

/** On a ScrollArea whose list is empty: the content fills the viewport, so an EmptyState centres in it. */
export const FILL_EMPTY_VIEWPORT =
  "[&_[data-slot=scroll-area-viewport]>div]:!block [&_[data-slot=scroll-area-viewport]>div]:h-full";
