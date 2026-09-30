import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { EncryptedKeyHeader, HomebaseFile, ThumbnailFile } from "@homebase-id/js-lib/core";
import { compareAcl, jsonStringify64 } from "@homebase-id/js-lib/helpers";
import type { Attribute } from "@homebase-id/js-lib/profile";


// Re-export Homebase SDK utilities for convenience
export { getNewId, tryJsonParse, base64ToUint8Array, uint8ArrayToBase64, stringToUint8Array, byteArrayToString } from '@homebase-id/js-lib/helpers';

// shadcn/ui className utility
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Reduce a post-auth redirect target to a safe, same-origin path. Anything that
 * isn't a same-origin http(s) URL — off-origin hosts, `javascript:` URIs,
 * protocol-relative `//host` targets, garbage — collapses to '/'. Guards the
 * /auth/finalize open redirect (SEC-07).
 */
export function sanitizeReturnUrl(raw: string, origin: string): string {
  try {
    const u = new URL(raw, origin);
    // A pathname starting with "//" (e.g. from "/.//evil.example") would be
    // read back as a protocol-relative URL by location.replace / navigate.
    return u.origin === origin &&
      (u.protocol === 'https:' || u.protocol === 'http:') &&
      !u.pathname.startsWith('//')
      ? u.pathname + u.search + u.hash
      : '/';
  } catch {
    return '/';
  }
}

/**
 * Serialize EncryptedKeyHeader to JSON string for database storage.
 * Converts Uint8Array fields to base64 strings.
 */
export function serializeKeyHeader(keyHeader: EncryptedKeyHeader): string {
  return jsonStringify64(keyHeader);
}


export function validateKeyHeader(result: EncryptedKeyHeader): boolean {
  return (
    typeof result.encryptionVersion === 'number' &&
    typeof result.type === 'string' &&
    result.iv.length > 0 &&
    result.encryptedAesKey.length > 0
  );
}


// TODO: Simplify this function
export const getHighestPrioAttributesFromMultiTypes = (
  attributes?: (HomebaseFile<Attribute | undefined> | null)[]
) => {
  if (!attributes) return undefined;

  return (
    attributes?.filter(
      (attr) => !!attr && !!attr.fileMetadata.appData.content
    ) as HomebaseFile<Attribute>[]
  )?.reduce((highestPrioArr, attr) => {
    const highAttr = highestPrioArr.find(
      (highAttr) =>
        highAttr.fileMetadata.appData.content.type === attr.fileMetadata.appData.content.type
    );
    if (!attr.fileMetadata.appData.content.data) return highestPrioArr;

    if (highAttr) {
      if (
        compareAcl(
          highAttr.serverMetadata?.accessControlList,
          attr.serverMetadata?.accessControlList
        ) ||
        highAttr.fileMetadata.appData.content.priority < attr.fileMetadata.appData.content.priority
      ) {
        return highestPrioArr;
      } else {
        return [
          ...highestPrioArr.filter(
            (highPrio) =>
              highPrio.fileMetadata.appData.content.type !== attr.fileMetadata.appData.content.type
          ),
          attr,
        ];
      }
    } else {
      return [...highestPrioArr, attr];
    }
  }, [] as HomebaseFile<Attribute>[]);
};


export const toArrayBufferBackedView = (bytes: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
};

/**
 * createThumbnails can't upscale past the source image's natural size, so a
 * source smaller than a thumbnail's target dimensions collapses multiple
 * additionalThumbnails onto the same pixelWidth x pixelHeight. The server's
 * dimension lookup then throws on the duplicate (#292). Keep the first
 * thumbnail seen per dimension pair.
 */
export const dedupeThumbnailsByDimensions = (thumbnails: ThumbnailFile[]): ThumbnailFile[] => {
  const seen = new Set<string>();
  return thumbnails.filter(({ pixelWidth, pixelHeight }) => {
    const key = `${pixelWidth}x${pixelHeight}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export function formatDate(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

export function formatRelativeTime(date: Date | string): string | null {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(d);
}

export function debounce<T extends (...args: never[]) => void>(
    fn: T,
    delay: number
): (...args: Parameters<T>) => void {
    let timeoutId: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
}
