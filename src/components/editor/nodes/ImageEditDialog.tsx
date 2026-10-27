/**
 * Crop, rotate and flip an image (#584). Non-destructive: Apply writes the edit
 * attrs in one step (one undo), and Reset brings back the original.
 */
import type { ReactNode } from "react";
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useSheetMode } from "@/hooks/useSheetMode";
import { EditedImage } from "@/components/EditedImage";
import { cn } from "@/lib/utils";
import type { Corner, ImageEdits } from "@/lib/images/imageEdits";
import { useImageEditDraft, type CropRatio } from "@/hooks/image/useImageEditDraft";

const RATIOS: { label: string; ratio: CropRatio }[] = [
  { label: "Free", ratio: null },
  { label: "Original", ratio: "original" },
  { label: "1:1", ratio: 1 },
  { label: "4:3", ratio: 4 / 3 },
  { label: "16:9", ratio: 16 / 9 },
];

const CORNERS: { corner: Corner; name: string; className: string }[] = [
  { corner: "nw", name: "top left", className: "left-0 top-0 cursor-nwse-resize" },
  { corner: "ne", name: "top right", className: "right-0 top-0 cursor-nesw-resize" },
  { corner: "sw", name: "bottom left", className: "bottom-0 left-0 cursor-nesw-resize" },
  { corner: "se", name: "bottom right", className: "bottom-0 right-0 cursor-nwse-resize" },
];

const pct = (n: number) => `${n * 100}%`;

interface ImageEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edits: ImageEdits;
  onApply: (edits: ImageEdits) => void;
  /** A fresh copy of the image, sized to fill its parent. */
  image: ReactNode;
}

export function ImageEditDialog({ open, onOpenChange, edits, onApply, image }: ImageEditDialogProps) {
  const sheet = useSheetMode();
  const apply = (next: ImageEdits) => {
    onApply(next);
    onOpenChange(false);
  };

  // On a phone the editor is a full-screen sheet, laid out like iOS Photos (#829)
  if (sheet) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent variant="full" showCloseButton={false}>
          <EditForm sheet edits={edits} image={image} onApply={apply} onCancel={() => onOpenChange(false)} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogTitle>Edit image</DialogTitle>
        <DialogDescription>Crop, rotate or flip. The original image is kept.</DialogDescription>
        {/* Mounted per opening, so the draft starts from the image's current edits */}
        <EditForm edits={edits} image={image} onApply={apply} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  sheet = false,
  edits,
  image,
  onApply,
  onCancel,
}: Pick<ImageEditDialogProps, "edits" | "image" | "onApply"> & { sheet?: boolean; onCancel: () => void }) {
  const { draft, ratio, rect, areaRef, pickRatio, startDrag, onKeyDown, rotate, flip, reset } = useImageEditDraft(edits);
  const tool = sheet
    ? "flex h-11 flex-1 items-center justify-center rounded-md border text-sm active:bg-accent"
    : "rounded-md border px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground";

  const overlay = (
    <div ref={areaRef} className="absolute inset-0" style={{ touchAction: "none" }}>
      <div
        tabIndex={0}
        role="group"
        aria-label="Crop area. Arrow keys move it, Shift moves further"
        data-testid="crop-area"
        onPointerDown={startDrag(null)}
        onKeyDown={onKeyDown(null)}
        // The shadow dims everything outside the crop; the frame clips it.
        className="absolute cursor-move shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] outline-2 outline-white focus-visible:outline-primary"
        style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
      >
        {CORNERS.map(({ corner, name, className }) => (
          <button
            key={corner}
            type="button"
            aria-label={`Crop corner (${name})`}
            onPointerDown={startDrag(corner)}
            onKeyDown={onKeyDown(corner)}
            className={cn("absolute flex h-5 w-5 items-center justify-center focus-visible:outline-2 focus-visible:outline-primary", sheet && "size-11", className)}
          >
            <span className="h-2.5 w-2.5 rounded-[2px] bg-white ring-1 ring-black/40" />
          </button>
        ))}
      </div>
    </div>
  );

  const picture = (
    // The whole image, turned and flipped as it will show; the crop is drawn over it
    <EditedImage
      edits={{ ...draft, crop: null }}
      maxHeight={sheet ? "calc(100dvh - 17rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))" : "55vh"}
      overlay={overlay}
    >
      {image}
    </EditedImage>
  );

  const ratios = (
    <div role="group" aria-label="Crop ratio" className={cn("flex gap-1", sheet ? "gap-2 overflow-x-auto" : "flex-wrap")}>
      {RATIOS.map(({ label, ratio: value }) => (
        <button
          key={label}
          type="button"
          aria-pressed={ratio === value}
          onClick={() => pickRatio(value)}
          className={cn(tool, sheet && "flex-auto px-3", ratio === value && "bg-accent text-accent-foreground")}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const turns = (
    <>
      <button type="button" aria-label="Rotate left" onClick={() => rotate(-1)} className={tool}>
        <RotateCcw className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Rotate right" onClick={() => rotate(1)} className={tool}>
        <RotateCw className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Flip horizontal" aria-pressed={draft.flipH} onClick={() => flip("flipH")} className={cn(tool, draft.flipH && "bg-accent text-accent-foreground")}>
        <FlipHorizontal2 className="h-4 w-4" />
      </button>
      <button type="button" aria-label="Flip vertical" aria-pressed={draft.flipV} onClick={() => flip("flipV")} className={cn(tool, draft.flipV && "bg-accent text-accent-foreground")}>
        <FlipVertical2 className="h-4 w-4" />
      </button>
    </>
  );

  if (sheet) {
    return (
      <>
        <SheetHeader className="flex-row items-center justify-between in-data-[variant=full]:px-2 in-data-[variant=full]:pb-2">
          <Button type="button" variant="ghost" className="h-11 px-3 text-base" onClick={onCancel}>
            Cancel
          </Button>
          <SheetTitle className="text-base">Edit image</SheetTitle>
          <SheetDescription className="sr-only">Crop, rotate or flip. The original image is kept.</SheetDescription>
          <Button type="button" variant="ghost" className="h-11 px-3 text-base font-semibold" onClick={() => onApply(draft)}>
            Apply
          </Button>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted p-3">{picture}</div>
        <SheetFooter className="pb-2">
          {ratios}
          <div className="flex gap-2">
            {turns}
            <button type="button" onClick={reset} className={tool}>
              Reset
            </button>
          </div>
        </SheetFooter>
      </>
    );
  }

  return (
    <>
      <div className="flex justify-center rounded-md bg-muted p-3">{picture}</div>

      <div className="flex flex-wrap items-center gap-1.5">
        {ratios}
        <div className="ml-auto flex gap-1">{turns}</div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={reset}>
          Reset
        </Button>
        <Button type="button" onClick={() => onApply(draft)}>
          Apply
        </Button>
      </DialogFooter>
    </>
  );
}
