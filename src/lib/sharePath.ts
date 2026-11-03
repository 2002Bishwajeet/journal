// A public /share/:identity/:noteId page must not pay for app-only boot work
// (service worker registration, persistent-storage request, ...). The
// trailing slash is deliberate: /share-target (the authenticated share
// target route) must not match.
export function isPublicSharePath(pathname: string): boolean {
    // The app's /mcp/code is public too: it only echoes query params as a login code.
    return pathname.startsWith('/share/') || pathname === `${import.meta.env.BASE_URL}mcp/code`;
}
