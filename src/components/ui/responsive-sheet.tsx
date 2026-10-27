import type { ComponentProps, ReactNode } from "react"

import { useSheetMode } from "@/hooks/useSheetMode"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

/**
 * One component for a picker or form: a sheet on phones and touch tablets (`bottom` for a
 * picker, `full` for a form), the centred dialog on desktop (#823).
 */
export function ResponsiveSheet({
  open,
  onOpenChange,
  variant = "bottom",
  title,
  description,
  footer,
  children,
  dialogClassName,
  onCloseAutoFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  variant?: "bottom" | "full"
  title: ReactNode
  description?: ReactNode
  footer?: ReactNode
  children: ReactNode
  /** Classes for the desktop dialog only. */
  dialogClassName?: string
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"]
}) {
  const asSheet = useSheetMode()
  // Radix warns about a dialog with no description unless it opts out.
  const describedBy = description ? {} : { "aria-describedby": undefined }

  if (asSheet) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent variant={variant} onCloseAutoFocus={onCloseAutoFocus} {...describedBy}>
          <SheetHeader>
            <SheetTitle>{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
          <SheetBody>{children}</SheetBody>
          {footer && <SheetFooter>{footer}</SheetFooter>}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={dialogClassName} onCloseAutoFocus={onCloseAutoFocus} {...describedBy}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
