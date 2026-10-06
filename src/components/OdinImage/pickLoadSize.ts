import type { ImageSize } from "@homebase-id/js-lib/core";

export interface PickLoadSizeInput {
  sizes: ImageSize[] | undefined;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  naturalSize?: ImageSize;
  avoidPayload?: boolean;
}

// Picks what to load for an <img> box: the first thumb larger than the box in device pixels,
// "full" when the box needs more pixels than the largest thumb has, or undefined when the box
// has no size yet (nothing to fetch).
export const pickLoadSize = ({
  sizes,
  cssWidth,
  cssHeight,
  dpr,
  naturalSize,
  avoidPayload,
}: PickLoadSizeInput): ImageSize | "full" | undefined => {
  if (!cssWidth || !cssHeight) return undefined;

  const scale = Math.ceil(dpr || 1);
  const targetWidth = cssWidth * scale;
  const targetHeight = cssHeight * scale;

  const match = sizes?.find(
    (size) => targetWidth < size.pixelWidth && targetHeight < size.pixelHeight
  );
  if (match) return match;

  const largest = sizes?.reduce<ImageSize | undefined>(
    (max, size) =>
      !max || size.pixelWidth * size.pixelHeight > max.pixelWidth * max.pixelHeight
        ? size
        : max,
    undefined
  );
  if (
    largest &&
    (targetWidth > largest.pixelWidth || targetHeight > largest.pixelHeight)
  ) {
    return avoidPayload ? largest : "full";
  }

  // The preview size is heavily rounded so we recalculate the pixelHeight
  return {
    pixelWidth: targetWidth,
    pixelHeight: naturalSize
      ? Math.round(targetWidth * (naturalSize.pixelHeight / naturalSize.pixelWidth))
      : targetHeight,
  };
};
