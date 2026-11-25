// Generic OAuth-on-Node adapter: no Journal imports, so any MCP behind mcp-gateway can copy it.
// See the gateway docs (github.com/2002Bishwajeet/mcp-gateway, docs/ARCHITECTURE.md, "Per-MCP contract").
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

/** An upload: a 5 MB image as a base64 data: URI is about 6.7 MB. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;
/** An MCP call: images come through upload URLs, and a data: URI in one is at most 256 KB. */
export const MCP_BODY_BYTES = 1024 * 1024;
/** Every other body: OAuth forms and registrations. */
export const SMALL_BODY_BYTES = 64 * 1024;

class TooLarge extends Error {}

async function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array<ArrayBuffer>> {
    if (Number(req.headers['content-length'] ?? 0) > limit) throw new TooLarge();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
        size += chunk.length;
        if (size > limit) throw new TooLarge();
        chunks.push(chunk);
    }
    return new Uint8Array(Buffer.concat(chunks));
}

/**
 * node:http to the app's Request → Response. The URL is the fixed public `origin` plus the request's path:
 * neither Host nor X-Forwarded-* is ever trusted. Bodies over their limit get 413 before the app sees them.
 * A `bearerPaths` request may carry up to MCP_BODY_BYTES with a Bearer token `validBearer` accepts, checked
 * before any of the body is read; without one it reaches the app with no body (the app answers 401). A request
 * to a path `opensLargeBody` accepts (a live single-use upload URL), also checked first, may carry up to
 * MAX_BODY_BYTES, one body at a time per path (429 for a second).
 * Every other body is capped at SMALL_BODY_BYTES.
 */
export function nodeListener(
    fetchApp: (request: Request) => Promise<Response>,
    origin: string,
    bearerPaths: string[] = [],
    opensLargeBody: (pathname: string) => Promise<boolean> = async () => false,
    validBearer: (token: string) => Promise<boolean> = async () => true
): RequestListener {
    /** Paths reading or serving a large body now: one at a time each. */
    const opening = new Set<string>();
    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const method = req.method ?? 'GET';
        const { pathname, search } = new URL(req.url ?? '/', 'http://localhost');
        const large = bearerPaths.includes(pathname);
        const hasBody = method !== 'GET' && method !== 'HEAD';
        const token = /^Bearer\s+(\S+)/i.exec(req.headers.authorization ?? '')?.[1];
        const bearer = large && hasBody && token !== undefined && (await validBearer(token));
        const opens = hasBody && !large && (await opensLargeBody(pathname));
        if (opens && opening.has(pathname)) {
            res.writeHead(429, { Connection: 'close', 'Retry-After': '5' }).end();
            req.destroy();
            return;
        }
        if (opens) opening.add(pathname);
        try {
            let body: Uint8Array<ArrayBuffer> | undefined;
            if (large && !bearer) req.resume();
            else if (hasBody) {
                try {
                    body = await readBody(req, large ? MCP_BODY_BYTES : opens ? MAX_BODY_BYTES : SMALL_BODY_BYTES);
                } catch (e) {
                    if (!(e instanceof TooLarge)) throw e;
                    res.writeHead(413, { Connection: 'close' }).end();
                    req.destroy();
                    return;
                }
            }
            const headers = new Headers();
            for (const [name, value] of Object.entries(req.headers)) {
                if (value === undefined) continue;
                for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
            }
            const response = await fetchApp(new Request(origin + pathname + search, { method, headers, body, redirect: 'manual' }));
            const out: Record<string, string | string[]> = {};
            response.headers.forEach((value, name) => {
                if (name !== 'set-cookie') out[name] = value;
            });
            const cookies = response.headers.getSetCookie();
            if (cookies.length) out['set-cookie'] = cookies;
            res.writeHead(response.status, out).end(Buffer.from(await response.arrayBuffer()));
        } finally {
            if (opens) opening.delete(pathname);
        }
    }

    return (req, res) => {
        handle(req, res).catch(() => {
            // Never log the error: it can hold user content or a request's tokens.
            console.error('MCP: a request failed');
            if (!res.headersSent) res.writeHead(500);
            res.end();
        });
    };
}
