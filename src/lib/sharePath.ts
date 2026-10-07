// A public /share/:identity/:noteId page must not pay for app-only boot work
// (service worker registration, persistent-storage request, ...). The
// trailing slash is deliberate: /share-target (the authenticated share
// target route) must not match.
export function isPublicSharePath(pathname: string): boolean {
    // /mcp/code is public too: it only echoes query params as a login code.
    return pathname.startsWith('/share/') || pathname === '/mcp/code';
}
