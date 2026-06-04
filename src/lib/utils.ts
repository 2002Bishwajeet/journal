import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { EncryptedKeyHeader, HomebaseFile } from "@homebase-id/js-lib/core";
import { compareAcl, jsonStringify64 } from "@homebase-id/js-lib/helpers";
import type { Attribute } from "@homebase-id/js-lib/profile";


// Re-export Homebase SDK utilities for convenience
export { getNewId, tryJsonParse, base64ToUint8Array, uint8ArrayToBase64, stringToUint8Array, byteArrayToString } from '@homebase-id/js-lib/helpers';

// shadcn/ui className utility
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
 * Formats a timestamp (unix ms number or ISO string) into a short human-readable
 * relative or absolute string suitable for "Last edited" display.
 *
 * Returns null if the value is falsy or unparseable.
 */
export function formatLastEditedAt(value: number | string | undefined | null): string | null {
  if (!value) return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (isNaN(date.getTime())) return null;

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMs < 0) return date.toLocaleString(); // future timestamp — just show it
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
