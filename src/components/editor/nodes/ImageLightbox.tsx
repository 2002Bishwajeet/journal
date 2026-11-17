/**
 * Full-resolution, click-to-zoom view of an image node. `attachment://` sources
 * reuse OdinImage to fetch the real payload at full size; everything else
 * (plain URLs, the pending upload's live object URL) is a plain <img>. An edited
 * image (#584) shows as edited.
 */
import { useContext, useEffect, useState, type CSSProperties } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { Dialog, DialogContent, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { OdinImage } from "@/components/OdinImage/OdinImage";
import { EditedImage } from "@/components/EditedImage";
import { useDotYouClientContext } from "@/components/auth";
import { JOURNAL_DRIVE } from "@/lib/homebase/config";
import { hasEdits, NO_EDITS, type ImageEdits } from "@/lib/images/imageEdits";
import { useImageDownload } from "@/hooks/image/useImageDownload";
import { useZoomPan } from "@/hooks/image/useZoomPan";
import { useSwipeToClose } from "@/hooks/image/useSwipeToClose";
import { useSwipeToStep } from "@/hooks/image/useSwipeToStep";
import { useLightboxGallery } from "@/hooks/image/useLightboxGallery";
import type { LightboxGallery, LightboxItem } from "@/lib/images/lightboxGallery";
import { useSheetMode } from "@/hooks/useSheetMode";
import { cn } from "@/lib/utils";
import { ImageOwnerContext } from "./imageOwnerContext";

interface ImageLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
  edits?: ImageEdits;
  /** The images of the gallery `src` is in, with `src`'s place among them (#1369): previous and next step through them. */
  gallery?: LightboxGallery;
}

/** The picture itself: an attachment fetched at full size, or a plain <img>, with its edits applied. */
function StageImage({ src, alt, edits }: { src: string; alt: string; edits: ImageEdits }) {
  const dotYouClient = useDotYouClientContext();
  const owner = useContext(ImageOwnerContext);
  const isAttachment = src.startsWith("attachment://");
  const [fileId, fileKey] = src.replace("attachment://", "").split("/");

  return hasEdits(edits) ? (
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
  );
}

/** The neighbours drawn unseen at the stage's size, so stepping to one finds it loaded (#1369). */
function Preload({ items }: { items: LightboxItem[] }) {
  return (
    <div aria-hidden className="pointer-events-none invisible absolute inset-0 flex items-center justify-center overflow-hidden">
      {items.map((item, i) => (
        <div key={i} className="absolute flex w-full justify-center">
          <StageImage src={item.src} alt={item.alt} edits={item.edits ?? NO_EDITS} />
        </div>
      ))}
    </div>
  );
}

/** Mounted only while the dialog is open, so every opening starts fitted. */
function ZoomStage({
  src,
  alt,
  edits,
  onClose,
  swipeY,
  onZoomedChange,
  onStep,
}: {
  src: string;
  alt: string;
  edits: ImageEdits;
  onClose: () => void;
  /** The full-screen viewer passes the value its background fades with; a swipe at fit moves it (#829). */
  swipeY?: MotionValue<number>;
  onZoomedChange?: (zoomed: boolean) => void;
  /** Set inside a gallery: a sideways swipe at fit steps to the next or previous image (#1369). */
  onStep?: (dir: -1 | 1) => void;
}) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const { view, stageProps, wasDragged } = useZoomPan(stage);
  const ownY = useMotionValue(0);
  const y = swipeY ?? ownY;
  const swipe = useSwipeToClose(y, Boolean(swipeY) && view.scale === 1, onClose);
  const step = useSwipeToStep(Boolean(onStep) && view.scale === 1, (dir) => onStep?.(dir));
  const zoomed = view.scale > 1;
  useEffect(() => onZoomedChange?.(zoomed), [zoomed, onZoomedChange]);

  return (
    // Wheel/pinch zooms, drag pans, double-click toggles fit and 100%
    <div
      ref={setStage}
      {...stageProps}
      onPointerDown={(e) => {
        stageProps.onPointerDown(e);
        swipe.onPointerDown(e);
        step.onPointerDown(e);
      }}
      onPointerMove={(e) => {
        stageProps.onPointerMove(e);
        swipe.onPointerMove(e);
      }}
      onPointerUp={(e) => {
        stageProps.onPointerUp(e);
        swipe.onPointerUp(e);
        step.onPointerUp(e);
      }}
      onPointerCancel={(e) => {
        stageProps.onPointerCancel(e);
        swipe.onPointerCancel(e);
        step.onPointerCancel(e);
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
        <StageImage src={src} alt={alt} edits={edits} />
      </div>
      </motion.div>
    </div>
  );
}

/** The tallest the image may grow: the dialog on desktop, the screen less the bars on a phone. */
const DESKTOP_MAX_H = "calc(95vh - 3rem)";
const PHONE_MAX_H = "calc(100dvh - 7rem - env(safe-area-inset-top) - env(safe-area-inset-bottom))";

type GalleryNav = ReturnType<typeof useLightboxGallery>;

/** Previous or next image; at an end it is disabled. */
function StepButton({ dir, nav, className }: { dir: -1 | 1; nav: GalleryNav; className: string }) {
  const Icon = dir === 1 ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      aria-label={dir === 1 ? "Next image" : "Previous image"}
      disabled={dir === 1 ? nav.atEnd : nav.atStart}
      onClick={() => nav.step(dir)}
      className={className}
    >
      <Icon aria-hidden />
    </button>
  );
}

/** "2 / 5", announced as it changes. */
function Position({ nav, className }: { nav: GalleryNav; className: string }) {
  return (
    <p aria-live="polite" className={cn("tabular-nums", className)}>
      {nav.index + 1} / {nav.count}
    </p>
  );
}

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
  nav,
  download,
}: ImageLightboxProps & { edits: ImageEdits; nav: GalleryNav; download: () => void }) {
  const y = useMotionValue(0);
  const background = useTransform(y, (v) => `rgb(0 0 0 / ${fade(v, 400)})`);
  const chrome = useTransform(y, (v) => fade(v, 120));
  const button =
    "flex size-11 items-center justify-center rounded-full text-white/90 outline-none focus-visible:ring-2 focus-visible:ring-white [&_svg]:size-6";
  // Zoomed in, the bar and the caption fade out and take no taps, as in Photos; back at fit they return (#833).
  // A state, not a :has() selector: one in the stylesheet slows every DOM change in the app.
  const [zoomed, setZoomed] = useState(false);
  const hideWhileZoomed = cn(
    "transition-opacity duration-(--duration-fade) ease-(--ease-standard)",
    zoomed && "pointer-events-none opacity-0",
  );

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
          className="fixed inset-x-0 top-0 z-50 flex h-dvh flex-col outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-(--duration-fade) ease-(--ease-standard)"
        >
          <DialogTitle className="sr-only">{alt || "Image preview"}</DialogTitle>
          <motion.div aria-hidden className="absolute inset-0 -z-10" style={{ backgroundColor: background }} />
          <div className={cn("nav-bar shrink-0", hideWhileZoomed)}>
            <motion.div
              style={{ opacity: chrome }}
              className="flex items-center justify-between px-2 pt-[env(safe-area-inset-top)]"
            >
              <DialogPrimitive.Close aria-label="Close" className={button}>
                <X aria-hidden />
              </DialogPrimitive.Close>
              {nav.count > 1 && (
                <div className="flex items-center">
                  <StepButton dir={-1} nav={nav} className={cn(button, "disabled:opacity-50")} />
                  <Position nav={nav} className="min-w-14 text-center text-[15px] leading-5 text-white/90" />
                  <StepButton dir={1} nav={nav} className={cn(button, "disabled:opacity-50")} />
                </div>
              )}
              <button type="button" aria-label="Download image" onClick={download} className={button}>
                <Download aria-hidden />
              </button>
            </motion.div>
          </div>
          <div style={{ "--viewer-max-h": PHONE_MAX_H } as CSSProperties} className="relative flex min-h-0 flex-1 flex-col">
            <ZoomStage
              key={nav.index}
              src={src}
              alt={alt}
              edits={edits}
              onClose={() => onOpenChange(false)}
              swipeY={y}
              onZoomedChange={setZoomed}
              onStep={nav.count > 1 ? nav.step : undefined}
            />
            <Preload items={nav.neighbours} />
          </div>
          {/* The caption is set like a list row's title (15/20), three lines at most. */}
          <div className={cn("shrink-0", hideWhileZoomed)}>
            <motion.p
              aria-hidden="true"
              style={{ opacity: chrome }}
              className="line-clamp-3 px-5 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center text-[15px] leading-5 text-balance text-white/90 empty:hidden"
            >
              {alt}
            </motion.p>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

export function ImageLightbox({ open, onOpenChange, src: openedSrc, alt: openedAlt, edits: openedEdits = NO_EDITS, gallery }: ImageLightboxProps) {
  const nav = useLightboxGallery(open, gallery, { src: openedSrc, alt: openedAlt, edits: openedEdits });
  const { src, alt } = nav.current;
  const edits = nav.current.edits ?? NO_EDITS;
  const download = useImageDownload(src, alt);
  const phone = useSheetMode();

  if (phone) {
    return <PhoneViewer open={open} onOpenChange={onOpenChange} src={src} alt={alt} edits={edits} nav={nav} download={download} />;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm:max-w-[95vw] overrides the base DialogContent's sm:max-w-lg, which
          otherwise caps the lightbox at 32rem. The fixed box also gives OdinImage
          a large clientWidth to pick its thumbnail size from. The close X keeps its
          top-right corner, with the Download button beside it. */}
      <DialogContent
        aria-label={alt || "Image preview"}
        onClick={(e) => {
          // The box covers the viewport, so treat clicks on the empty area as outside clicks.
          if (e.target === e.currentTarget) onOpenChange(false);
        }}
        className="flex h-[95vh] w-[95vw] max-w-[95vw] sm:max-w-[95vw] flex-col items-center justify-center gap-3 p-0 bg-transparent border-0 shadow-none [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-4"
      >
        <button
          type="button"
          aria-label="Download image"
          onClick={download}
          className="absolute top-4 right-12 z-10 rounded-xs p-0.5 text-white/80 hover:text-white focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="size-4" />
        </button>
        {nav.count > 1 && (
          <>
            <Position nav={nav} className="absolute top-4 left-1/2 z-10 -translate-x-1/2 text-sm text-white/90" />
            {([-1, 1] as const).map((dir) => (
              <StepButton
                key={dir}
                dir={dir}
                nav={nav}
                className={cn(
                  "absolute top-1/2 z-10 -translate-y-1/2 rounded-xs p-0.5 text-white/80 hover:text-white focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 [&_svg]:size-8",
                  dir === 1 ? "right-4" : "left-4",
                )}
              />
            ))}
          </>
        )}
        <div style={{ "--viewer-max-h": DESKTOP_MAX_H } as CSSProperties} className="relative flex min-h-0 w-full flex-1 flex-col">
          <ZoomStage key={nav.index} src={src} alt={alt} edits={edits} onClose={() => onOpenChange(false)} onStep={nav.count > 1 ? nav.step : undefined} />
          <Preload items={nav.neighbours} />
        </div>
        {alt && <p aria-hidden="true" className="text-center text-sm text-white/90">{alt}</p>}
      </DialogContent>
    </Dialog>
  );
}
