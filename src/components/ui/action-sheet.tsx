import type { ComponentProps } from "react"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ContextMenuItemConfig } from "@/components/ui/context-menu-wrapper"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"

const group = "bg-muted divide-border divide-y overflow-hidden rounded-xl"
const row =
  "active:bg-accent flex h-13 w-full items-center gap-3 px-4 text-left text-base outline-none focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0"

/**
 * A list of 52 px rows in a bottom sheet (the iOS action sheet): destructive rows in their own
 * red group, and a separate Cancel row last. `title` names it for screen readers and is not shown.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  items,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  items: ContextMenuItemConfig[]
  onCloseAutoFocus?: ComponentProps<typeof SheetContent>["onCloseAutoFocus"]
}) {
  const renderRow = (item: ContextMenuItemConfig) => {
    const Icon = item.icon
    return (
      <button
        key={item.label}
        type="button"
        role={item.checked === undefined ? "menuitem" : "menuitemradio"}
        aria-checked={item.checked}
        disabled={item.disabled}
        onClick={() => {
          item.action()
          onOpenChange(false)
        }}
        className={cn(row, item.variant === "destructive" && "text-destructive")}
      >
        {Icon && <Icon aria-hidden />}
        {item.label}
        {item.checked && <CheckIcon aria-hidden className="ml-auto" />}
      </button>
    )
  }
  const isLast = (item: ContextMenuItemConfig) => item.variant === "destructive" || item.separate
  const regular = items.filter((item) => !isLast(item))
  const destructive = items.filter(isLast)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent variant="bottom" aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader className="sr-only">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-2 overflow-y-auto px-4">
          <div role="menu" aria-label={title} className="flex flex-col gap-2">
            {regular.length > 0 && <div role="group" className={group}>{regular.map(renderRow)}</div>}
            {destructive.length > 0 && <div role="group" className={group}>{destructive.map(renderRow)}</div>}
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn(row, group, "justify-center font-semibold")}
          >
            Cancel
          </button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
