import { DotYouClient, type ImageSize } from "@homebase-id/js-lib/core";
import { useImage } from "@/hooks/image/useImage";
import { useEffect } from "react";
import type { ImageEvents, ImageSource } from "./types";

export interface OdinPayloadImageProps
  extends ImageSource,
    ImageEvents,
    Omit<
      React.DetailedHTMLProps<
        React.ImgHTMLAttributes<HTMLImageElement>,
        HTMLImageElement
      >,
      "onError"
    > {
  dotYouClient: DotYouClient;

  naturalSize?: ImageSize;
}

// Component to render a tiny thumb image;
// Uses either the previewThumbnail provided or fetches the thumbnail from the server
export const OdinPayloadImage = ({
  dotYouClient,
  odinId,
  targetDrive,
  fileId,
  globalTransitId,
  fileKey,
  systemFileType,
  lastModified,
  naturalSize,

  probablyEncrypted,

  onError,
  preferObjectUrl,
  ...props
}: OdinPayloadImageProps) => {
  const {
    data: imageData,
    error: imageError,
    isFetched: isImageFetched,
  } = useImage({
    dotYouClient,
    odinId,
    imageFileId: fileId,
    imageGlobalTransitId: globalTransitId,
    imageFileKey: fileKey,
    imageDrive: targetDrive,
    size: undefined,
    probablyEncrypted,
    naturalSize,
    systemFileType,
    lastModified,
    preferObjectUrl,
  }).fetch;

  // Error handling
  useEffect(() => {
    if (imageError) onError?.();
  }, [imageError, onError]);

  useEffect(() => {
    if (isImageFetched && !imageData) onError?.();
  }, [imageData, isImageFetched, onError]);

  return <img src={imageData?.url} crossOrigin="anonymous" onError={onError} {...props} />;
};
