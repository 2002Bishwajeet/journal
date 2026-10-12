/**
 * Crop, rotate and flip an image (#584). Non-destructive: Apply writes the edit
 * attrs in one step (one undo), and Reset brings back the original.
 */
import type { ReactNode } from "react";
import { FlipHorizontal2, FlipVertical2, RotateCcw, RotateCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogTitle>Edit image</DialogTitle>
        <DialogDescription>Crop, rotate or flip. The original image is kept.</DialogDescription>
        {/* Mounted per opening, so the draft starts from the image's current edits */}
        <EditForm
          edits={edits}
          image={image}
          onApply={(next) => {
            onApply(next);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ edits, image, onApply }: Pick<ImageEditDialogProps, "edits" | "image" | "onApply">) {
  const { draft, ratio, rect, areaRef, pickRatio, startDrag, onKeyDown, rotate, flip, reset } = useImageEditDraft(edits);
  const tool = "rounded-md border px-2 py-1 text-xs hover:bg-accent hover:text-accent-foreground";

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
            className={cn("absolute flex h-5 w-5 items-center justify-center focus-visible:outline-2 focus-visible:outline-primary", className)}
          >
            <span className="h-2.5 w-2.5 rounded-[2px] bg-white ring-1 ring-black/40" />
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="flex justify-center rounded-md bg-muted p-3">
        {/* The whole image, turned and flipped as it will show; the crop is drawn over it */}
        <EditedImage edits={{ ...draft, crop: null }} maxHeight="55vh" overlay={overlay}>
          {image}
        </EditedImage>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label="Crop ratio" className="flex flex-wrap gap-1">
          {RATIOS.map(({ label, ratio: value }) => (
            <button
              key={label}
              type="button"
              aria-pressed={ratio === value}
              onClick={() => pickRatio(value)}
              className={cn(tool, ratio === value && "bg-accent text-accent-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
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
        </div>
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
