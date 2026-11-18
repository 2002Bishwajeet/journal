import { useEffect, useRef, useState } from "react";
import {
  OdinPreviewImage,
  type OdinPreviewImageProps,
} from "./OdinPreviewImage";
import { OdinThumbnailImage } from "./OdinThumbnailImage";
import { OdinPayloadImage } from "./OdinPayloadImage";
import { pickLoadSize } from "./pickLoadSize";
import { Loader2, AlertCircle } from "lucide-react";
import type { ImageSize } from "@homebase-id/js-lib/core";

import { useIntersection } from "@/hooks/useIntersection";
import { useOnlineContext } from "@/hooks/useOnlineContext";
import type { ThumbnailMeta } from "@homebase-id/js-lib/media";

export interface OdinImageProps
  extends Omit<Omit<OdinPreviewImageProps, "onLoad">, "blockFetchFromServer"> {
  probablyEncrypted?: boolean;

  lazyLoad?: boolean;
  onLoad?: () => void;
  avoidPayload?: boolean;
  fit?: "cover" | "contain";
  position?: "left" | "center";
  preferObjectUrl?: boolean; // => Prefer image urls over base64; But the objectUrls are never cleared after use;

  maxWidth?: string;

  /**
   * The image's size when the caller knows it (#1387): the box holds this size from the first
   * paint and keeps it, instead of taking the tiny thumbnail's, then the loaded one's.
   */
  initialSize?: ImageSize;
  /** The thumbnail sizes the caller knows (from the file header), so none has to be fetched to pick one. */
  thumbSizes?: ImageSize[];
}

const thumblessContentTypes = ["image/svg+xml", "image/gif"];

export const OdinImage = ({
  className,
  previewThumbnail,
  probablyEncrypted,
  avoidPayload,
  fit,
  position,
  onLoad,
  lazyLoad = true,
  maxWidth,
  initialSize,
  thumbSizes,
  ...props
}: OdinImageProps) => {
  const imgFitClassNames = `${
    fit === "cover"
      ? "w-full h-full object-cover"
      : fit === "contain"
      ? `max-h-[inherit] ${
          position === "left" ? "my-auto" : "m-auto"
        } object-contain`
      : ""
  }`;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const previewImgRef = useRef<HTMLImageElement>(null);

  const [isTinyLoaded, setIsTinyLoaded] = useState(false);
  const [isFinal, setIsFinal] = useState(false);
  const [isFatalError, setIsFatalError] = useState(false);

  const [isInView, setIsInView] = useState(!lazyLoad);
  useIntersection(wrapperRef, () => setIsInView(true));

  const [loadSize, setLoadSize] = useState<ImageSize | "full" | undefined>(
    undefined
  );

  const [naturalSize, setNaturalSizeState] = useState<ImageSize | undefined>(
    initialSize ?? previewThumbnail
  );
  // A size the caller gave is final: the tiny thumbnail's and the loaded one's are rounded
  const setNaturalSize = (update: (old: ImageSize | undefined) => ImageSize | undefined) => {
    if (!initialSize) setNaturalSizeState(update);
  };
  const [tinyThumb, setTinyThumb] = useState<ThumbnailMeta | undefined>();

  const weDontHaveSourceProps =
    !props.fileId || !props.fileKey || !props.targetDrive;

  const calculateSize = () => {
    if (loadSize !== undefined) return;

    // If no element or nothing to create a size that has the aspect ratio, don't bother and load full...
    // If the image is an svg.. Then there are no thumbs and we should just load the full image;
    if (
      !previewImgRef.current ||
      thumblessContentTypes.includes(
        previewThumbnail?.contentType || tinyThumb?.contentType || ""
      ) ||
      (tinyThumb ? !tinyThumb.sizes?.length : thumbSizes && !thumbSizes.length)
    ) {
      setLoadSize(
        avoidPayload ? { pixelHeight: 200, pixelWidth: 200 } : "full"
      );
      return;
    }

    setLoadSize(
      pickLoadSize({
        sizes: tinyThumb?.sizes ?? thumbSizes,
        cssWidth: previewImgRef.current.clientWidth,
        cssHeight: previewImgRef.current.clientHeight,
        dpr: window.devicePixelRatio,
        naturalSize,
        avoidPayload,
      })
    );
  };

  useEffect(() => {
    // Once we have the tinyThumb, we can calculate the size. An embedded preview loads at
    // once, so wait for the view too: only the placeholder is eager, the bytes stay lazy (#1387).
    // Note: calculateSize is not in deps because it uses component state that changes,
    // and we only want to trigger this once when both become true
    if (isTinyLoaded && isInView) calculateSize();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- calculateSize uses complex state/refs, safe to omit from deps as we only want to trigger on isTinyLoaded and isInView
  }, [isTinyLoaded, isInView]);

  if (weDontHaveSourceProps) return null;

  return (
    <div
      className={`${
        className && className?.indexOf("absolute") !== -1 ? "" : "relative"
      } overflow-hidden ${
        fit !== "cover"
          ? `${position === "left" ? "my-auto" : "m-auto"} h-auto w-full`
          : ""
      } ${className ?? ""}`}
      ref={wrapperRef}
      data-odinid={props.odinId}
      data-load-size={
        loadSize && loadSize !== "full"
          ? `${loadSize.pixelWidth}x${loadSize.pixelHeight}`
          : loadSize
      }
      data-natural-size={
        naturalSize
          ? `${naturalSize.pixelWidth}x${naturalSize.pixelHeight}`
          : "none"
      }
      data-probably-encrypted={probablyEncrypted}
      data-fileid={props.fileId}
      data-globaltransitid={props.globalTransitId}
      data-filekey={props.fileKey}
      style={
        naturalSize?.pixelWidth && naturalSize?.pixelHeight && fit !== "cover"
          ? {
              aspectRatio: `${naturalSize?.pixelWidth}/${naturalSize?.pixelHeight}`,
              maxWidth: maxWidth || `${naturalSize.pixelWidth}px`,
            }
          : undefined
      }
    >
      <OdinPreviewImage
        {...props}
        previewThumbnail={previewThumbnail}
        onLoad={(
          naturalSize: ImageSize | undefined,
          tinyThumb: ThumbnailMeta | undefined
        ) => {
          setNaturalSize((oldVal) => naturalSize || oldVal);
          setTinyThumb(tinyThumb);
          setIsTinyLoaded(true);
        }}
        className={`absolute inset-0 transition-opacity delay-500 ${imgFitClassNames} ${
          fit === "contain" ? (position === "left" ? "object-left" : "") : ""
        } ${isFinal ? "opacity-0" : "opacity-100"}`}
        onError={() => setIsTinyLoaded(true)}
        ref={previewImgRef}
        blur="auto"
        blockFetchFromServer={!isInView}
      />

      {!isFinal && !isFatalError ? (
        <TinyThumbLoader isTinyLoaded={isTinyLoaded} />
      ) : null}
      {loadSize === "full" ? (
        <OdinPayloadImage
          {...props}
          naturalSize={naturalSize}
          probablyEncrypted={probablyEncrypted}
          style={
            naturalSize?.pixelWidth && naturalSize?.pixelHeight
              ? {
                  aspectRatio: `${naturalSize?.pixelWidth}/${naturalSize?.pixelHeight}`,
                }
              : undefined
          }
          onLoad={() => {
            setIsFinal(true);
            onLoad?.();
          }}
          onError={() => setIsFatalError(true)}
          className={`relative transition-opacity duration-300 ${imgFitClassNames} ${
            isFinal ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : loadSize !== undefined ? (
        <OdinThumbnailImage
          {...props}
          naturalSize={naturalSize}
          probablyEncrypted={probablyEncrypted}
          loadSize={loadSize}
          style={
            naturalSize?.pixelWidth && naturalSize?.pixelHeight
              ? {
                  aspectRatio: `${naturalSize?.pixelWidth}/${naturalSize?.pixelHeight}`,
                }
              : undefined
          }
          onLoad={(e) => {
            // We re-set the natural size as this would be the max size/thumb of the image.
            // Read it now: React may run the updater during a later render, when currentTarget is null
            const { naturalWidth, naturalHeight } = e.currentTarget;
            setNaturalSize(() =>
              naturalWidth && naturalHeight
                ? { pixelWidth: naturalWidth, pixelHeight: naturalHeight }
                : undefined
            );
            setIsFinal(true);
            onLoad?.();
          }}
          onError={() => setIsFatalError(true)}
          className={`relative transition-opacity duration-300 ${imgFitClassNames} ${
            isFinal ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}
      {isFatalError ? <FatalError /> : null}
    </div>
  );
};

const TinyThumbLoader = ({ isTinyLoaded }: { isTinyLoaded: boolean }) => (
  <div
    className={`absolute inset-0 flex text-white transition-opacity delay-[2000ms] ${
      isTinyLoaded ? "opacity-100" : "opacity-0"
    }`}
  >
    <Loader2 className="m-auto h-7 w-7 animate-spin" />
  </div>
);

export const FatalError = () => {
  const { isOnline } = useOnlineContext();
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center bg-white/75 dark:bg-black/75`}
    >
      <AlertCircle className="mr-2 h-6 w-6 text-destructive" />{" "}
      <p className="text-sm">
        {isOnline ? "Something went wrong" : "Image available when online"}
      </p>
    </div>
  );
};
