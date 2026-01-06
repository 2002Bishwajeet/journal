/**
 * Helper to convert external image URLs to proxied URLs for COEP compliance.
 * Use this when displaying external images that need to work with SharedArrayBuffer/OPFS.
 * 
 * @param externalUrl - The external image URL to proxy
 * @returns A proxied URL that goes through the service worker
 */
export function getProxiedImageUrl(externalUrl: string): string {
    // Don't proxy local URLs or data URLs
    if (
        externalUrl.startsWith('/') ||
        externalUrl.startsWith('data:') ||
        externalUrl.startsWith('blob:')
    ) {
        return externalUrl;
    }

    // Don't proxy if already from same origin
    try {
        const url = new URL(externalUrl);
        if (url.origin === window.location.origin) {
            return externalUrl;
        }
    } catch {
        return externalUrl;
    }

    return `/proxy-image/${encodeURIComponent(externalUrl)}`;
}

/**
 * Check if an image URL needs proxying for COEP compliance
 */
export function needsProxy(imageUrl: string): boolean {
    if (
        imageUrl.startsWith('/') ||
        imageUrl.startsWith('data:') ||
        imageUrl.startsWith('blob:')
    ) {
        return false;
    }

    try {
        const url = new URL(imageUrl);
        return url.origin !== window.location.origin;
    } catch {
        return false;
    }
}
