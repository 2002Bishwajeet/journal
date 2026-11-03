import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import {
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  type DragControls,
  type PanInfo,
} from "framer-motion"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { followKeyboardBottom } from "@/lib/keyboardViewport"
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog"

// A sheet slides up from the bottom of a phone screen (#823). `bottom` is as tall as its
// content (capped below the status bar) for contextual actions and pickers; `full` covers
// the screen for forms. It is the Radix dialog (focus trap, aria-modal, Escape, and the
// history entry that makes Back close it), so it is controlled: pass `open` and `onOpenChange`.

type SheetVariant = "bottom" | "full"

const SheetContext = React.createContext<{ close: () => void }>({ close: () => {} })
// Set by SheetContent; the grabber and the header start the drag, so the scrolling body never does.
const SheetDragContext = React.createContext<DragControls | null>(null)

/** A drag past this share of the sheet's height closes it. */
const DISMISS_FRACTION = 0.3
/** A flick faster than this (px/s) closes it from any distance. */
const DISMISS_VELOCITY = 500

function Sheet({
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return (
    <SheetContext value={{ close: () => onOpenChange?.(false) }}>
      <Dialog onOpenChange={onOpenChange} {...props} />
    </SheetContext>
  )
}

function SheetContent({
  variant = "bottom",
  showCloseButton = true,
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  variant?: SheetVariant
  /** Off when the header carries its own Cancel and Apply (the image editor, #829). */
  showCloseButton?: boolean
}) {
  const { close } = React.useContext(SheetContext)
  const controls = useDragControls()
  const y = useMotionValue(0)
  const reduceMotion = useReducedMotion()
  const contentRef = React.useRef<HTMLElement | null>(null)

  function handleDragEnd(_event: unknown, info: PanInfo) {
    const el = contentRef.current
    const height = el?.offsetHeight ?? 0
    if (info.offset.y > height * DISMISS_FRACTION || info.velocity.y > DISMISS_VELOCITY) {
      const done = () => {
        // Already off screen: skip the CSS exit animation so the sheet does not jump back first.
        if (el) el.style.animation = "none"
        close()
      }
      if (reduceMotion) done()
      else animate(y, height, { duration: 0.2, ease: "easeOut", onComplete: done })
    } else if (reduceMotion) {
      y.set(0)
    } else {
      animate(y, 0, { type: "spring", stiffness: 500, damping: 40 })
    }
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      <SheetDragContext value={controls}>
        <DialogPrimitive.Content
          asChild
          {...props}
          onOpenAutoFocus={(event) => {
            props.onOpenAutoFocus?.(event)
            if (event.defaultPrevented) return
            // Focus the sheet itself, not its first control: on a phone that only paints a
            // focus ring or highlight on a button nobody touched.
            event.preventDefault()
            contentRef.current?.focus()
          }}
          onInteractOutside={(event) => {
            // Toasts live outside the sheet; touching one is not an outside click.
            if ((event.target as Element | null)?.closest?.("[data-sonner-toaster]")) {
              event.preventDefault()
            }
            props.onInteractOutside?.(event)
          }}
        >
          <motion.div
            data-slot="sheet-content"
            data-variant={variant}
            // With the keyboard up (iOS), lift the sheet to sit on top of it. `transition-none`: the
            // durations below are for the slide animations; a transition would make `bottom` and
            // `max-height` trail the keyboard.
            ref={(el: HTMLDivElement | null) => {
              contentRef.current = el
              return followKeyboardBottom(el)
            }}
            style={{ y }}
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 1 }}
            dragMomentum={false}
            onDragEnd={handleDragEnd}
            className={cn(
              "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom-full data-[state=closed]:slide-out-to-bottom-full fixed z-50 flex flex-col overflow-hidden shadow-lg transition-none duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-[state=closed]:duration-200 outline-none",
              variant === "bottom" &&
                "inset-x-0 bottom-[var(--sheet-bottom,0px)] max-h-[calc(var(--sheet-h,100dvh)-env(safe-area-inset-top)-2rem)] rounded-t-2xl border-t pb-[max(1rem,env(safe-area-inset-bottom))]",
              variant === "full" &&
                "inset-x-0 top-0 bottom-[var(--sheet-bottom,0px)] pb-[env(safe-area-inset-bottom)]",
              className
            )}
          >
            {variant === "bottom" && <SheetGrabber />}
            {children}
            {variant === "full" && showCloseButton && (
              <DialogClose
                data-slot="sheet-close"
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring absolute top-[env(safe-area-inset-top)] right-1 flex size-11 items-center justify-center rounded-md outline-none focus-visible:ring-2 [&_svg]:size-5"
              >
                <XIcon aria-hidden />
                <span className="sr-only">Close</span>
              </DialogClose>
            )}
          </motion.div>
        </DialogPrimitive.Content>
      </SheetDragContext>
    </DialogPortal>
  )
}

function SheetGrabber() {
  const controls = React.useContext(SheetDragContext)
  return (
    <div
      data-slot="sheet-grabber"
      aria-hidden
      onPointerDown={(e) => controls?.start(e)}
      className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
    >
      <div className="bg-muted-foreground/40 h-[5px] w-9 rounded-full" />
    </div>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  const controls = React.useContext(SheetDragContext)
  return (
    <div
      data-slot="sheet-header"
      onPointerDown={(e) => controls?.start(e)}
      className={cn(
        "flex shrink-0 touch-none flex-col gap-1 px-4 pb-3 text-left",
        // A bottom sheet's grabber already sits above; a full sheet's bar clears the status bar.
        "in-data-[variant=full]:border-b in-data-[variant=full]:pt-[calc(env(safe-area-inset-top)+0.75rem)] in-data-[variant=full]:pr-14",
        className
      )}
      {...props}
    />
  )
}

/** The part of the sheet that scrolls. */
function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "flex shrink-0 flex-col gap-2 px-4 pt-3 max-sm:*:data-[slot=button]:h-11",
        className
      )}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogTitle
      data-slot="sheet-title"
      className={cn("text-lg leading-tight font-semibold", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogDescription
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
}
