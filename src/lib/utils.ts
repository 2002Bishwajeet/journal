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
 * Reduce a post-auth redirect target to a safe, same-origin path. Anything that
 * isn't a same-origin http(s) URL — off-origin hosts, `javascript:` URIs,
 * protocol-relative `//host` targets, garbage — collapses to '/'. Guards the
 * /auth/finalize open redirect (SEC-07).
 */
export function sanitizeReturnUrl(raw: string, origin: string): string {
  try {
    const u = new URL(raw, origin);
    return u.origin === origin && (u.protocol === 'https:' || u.protocol === 'http:')
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
