/**
 * Full-resolution, click-to-zoom view of an image node. `attachment://` sources
 * reuse OdinImage to fetch the real payload at full size; everything else
 * (plain URLs, the pending upload's live object URL) is a plain <img>. An edited
 * image (#584) shows as edited.
 */
import { useContext, useState, type CSSProperties } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import { Download, X } from "lucide-react";
import { Dialog, DialogContent, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { OdinImage } from "@/components/OdinImage/OdinImage";
import { EditedImage } from "@/components/EditedImage";
import { useDotYouClientContext } from "@/components/auth";
import { JOURNAL_DRIVE } from "@/lib/homebase/config";
import { hasEdits, NO_EDITS, type ImageEdits } from "@/lib/images/imageEdits";
import { useImageDownload } from "@/hooks/image/useImageDownload";
import { useZoomPan } from "@/hooks/image/useZoomPan";
import { useSwipeToClose } from "@/hooks/image/useSwipeToClose";
import { useSheetMode } from "@/hooks/useSheetMode";
import { ImageOwnerContext } from "./imageOwnerContext";

interface ImageLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  edits?: ImageEdits;
}

/** Mounted only while the dialog is open, so every opening starts fitted. */
function ZoomStage({
  src,
  alt,
  edits,
  onClose,
  swipeY,
}: {
  src: string;
  alt: string;
  edits: ImageEdits;
  onClose: () => void;
  /** The full-screen viewer passes the value its background fades with; a swipe at fit moves it (#829). */
  swipeY?: MotionValue<number>;
}) {
  const dotYouClient = useDotYouClientContext();
  const owner = useContext(ImageOwnerContext);
  const isAttachment = src.startsWith("attachment://");
  const [fileId, fileKey] = src.replace("attachment://", "").split("/");
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const { view, stageProps, wasDragged } = useZoomPan(stage);
  const edited = hasEdits(edits);
  const ownY = useMotionValue(0);
  const y = swipeY ?? ownY;
  const swipe = useSwipeToClose(y, Boolean(swipeY) && view.scale === 1, onClose);

  return (
    // Wheel/pinch zooms, drag pans, double-click toggles fit and 100%
    <div
      ref={setStage}
      {...stageProps}
      onPointerDown={(e) => {
        stageProps.onPointerDown(e);
        swipe.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        stageProps.onPointerMove(e);
        swipe.onPointerMove(e);
      }}
      onPointerUp={(e) => {
        stageProps.onPointerUp(e);
        swipe.onPointerUp(e);
      }}
      onPointerCancel={(e) => {
        stageProps.onPointerCancel(e);
        swipe.onPointerCancel(e);
      }}
      onClick={(e) => {
        stageProps.onClick(e);
        // Zoomed in, the empty area is part of a pan or double-click, not a dismissal
        if (e.target === e.currentTarget && view.scale === 1 && !wasDragged()) onClose();
      }}
      // A native image drag would cancel the pointer stream a pan needs
      onDragStart={(e) => e.preventDefault()}
      style={{ touchAction: "none" }}
      className={`flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden ${view.scale > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <motion.div style={{ y }} className="flex w-full justify-center">
      <div
        data-testid="lightbox-zoom"
        // w-full, not shrink-wrapped: OdinImage is 100% of this box, so a
        // shrink-wrapped box collapses both to 0×0 and the image never shows.
        className="flex w-full justify-center"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {edited ? (
          // The edited box fits the stage; the image fills the frame's layer
          <EditedImage edits={edits} maxHeight="var(--viewer-max-h)">
            {isAttachment ? (
              <OdinImage
                dotYouClient={dotYouClient}
                odinId={owner}
                targetDrive={JOURNAL_DRIVE}
                fileId={fileId}
                fileKey={fileKey}
                alt={alt}
                lazyLoad={false}
                maxWidth="none"
              />
            ) : (
              <img src={src} alt={alt} className="block h-full w-full" />
            )}
          </EditedImage>
        ) : isAttachment ? (
          <OdinImage
            dotYouClient={dotYouClient}
            odinId={owner}
            targetDrive={JOURNAL_DRIVE}
            fileId={fileId}
            fileKey={fileKey}
            alt={alt}
            lazyLoad={false}
            fit="contain"
            className="max-h-[var(--viewer-max-h)]"
          />
        ) : (
          <img src={src} alt={alt} className="max-h-[var(--viewer-max-h)] max-w-full object-contain" />
        )}
      </div>
      </motion.div>
    </div>
  );
}

/** The tallest the image may grow: the dialog on desktop, the screen less the bars on a phone. */
const DESKTOP_MAX_H = "calc(95vh - 3rem)";
const PHONE_MAX_H = "calc(100dvh - 7rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))";

/** Near black while at rest, see-through as the image is pulled away. */
const fade = (y: number, over: number) => Math.max(0, 1 - Math.abs(y) / over);

/**
 * The viewer on a phone (#829): the whole screen on black. The bar clears the status bar, its
 * buttons are finger sized, the caption clears the home indicator, and a swipe at fit closes.
 */
function PhoneViewer({
  open,
  onOpenChange,
  src,
  alt,
  edits,
  download,
}: ImageLightboxProps & { edits: ImageEdits; download: () => void }) {
  const y = useMotionValue(0);
  const background = useTransform(y, (v) => `rgb(0 0 0 / ${fade(v, 400)})`);
  const chrome = useTransform(y, (v) => fade(v, 120));
  const button =
    "flex size-11 items-center justify-center rounded-full text-white/90 outline-none focus-visible:ring-2 focus-visible:ring-white [&_svg]:size-6";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Focus the viewer, not Close: on a phone that only paints a ring on a button nobody touched.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-200"
        >
          <DialogTitle className="sr-only">{alt || "Image preview"}</DialogTitle>
          <motion.div aria-hidden className="absolute inset-0 -z-10" style={{ backgroundColor: background }} />
          <motion.div
            style={{ opacity: chrome }}
            className="flex shrink-0 items-center justify-between px-2 pt-[env(safe-area-inset-top)]"
          >
            <DialogPrimitive.Close aria-label="Close" className={button}>
              <X aria-hidden />
            </DialogPrimitive.Close>
            <button type="button" aria-label="Download image" onClick={download} className={button}>
              <Download aria-hidden />
            </button>
          </motion.div>
          <div style={{ "--viewer-max-h": PHONE_MAX_H } as CSSProperties} className="flex min-h-0 flex-1 flex-col">
            <ZoomStage src={src} alt={alt} edits={edits} onClose={() => onOpenChange(false)} swipeY={y} />
          </div>
          <motion.p
            aria-hidden="true"
            style={{ opacity: chrome }}
            className="shrink-0 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-sm text-white/90 empty:hidden"
          >
            {alt}
          </motion.p>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

export function ImageLightbox({ open, onOpenChange, src, alt, edits = NO_EDITS }: ImageLightboxProps) {
  const download = useImageDownload(src, alt);
  const phone = useSheetMode();

  if (phone) {
    return <PhoneViewer open={open} onOpenChange={onOpenChange} src={src} alt={alt} edits={edits} download={download} />;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm:max-w-[95vw] overrides the base DialogContent's sm:max-w-lg, which
          otherwise caps the lightbox at 32rem. The fixed box also gives OdinImage
          a large clientWidth to pick its thumbnail size from. */}
      <DialogContent
        aria-label={alt || "Image preview"}
        onClick={(e) => {
          // The box covers the viewport, so treat clicks on the empty area as outside clicks.
          if (e.target === e.currentTarget) onOpenChange(false);
        }}
        className="flex h-[95vh] w-[95vw] max-w-[95vw] sm:max-w-[95vw] flex-col items-center justify-center gap-3 p-0 bg-transparent border-0 shadow-none"
      >
        <button
          type="button"
          aria-label="Download image"
          onClick={download}
          className="absolute top-4 right-12 z-10 rounded-xs p-0.5 text-white/80 hover:text-white focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="size-4" />
        </button>
        <div style={{ "--viewer-max-h": DESKTOP_MAX_H } as CSSProperties} className="flex min-h-0 w-full flex-1 flex-col">
          <ZoomStage src={src} alt={alt} edits={edits} onClose={() => onOpenChange(false)} />
        </div>
        {alt && <p aria-hidden="true" className="text-center text-sm text-white/90">{alt}</p>}
      </DialogContent>
    </Dialog>
  );
}
