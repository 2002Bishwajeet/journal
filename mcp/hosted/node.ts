// Generic OAuth-on-Node adapter: no Journal imports, so any MCP behind mcp-gateway can copy it.
// See the gateway docs (github.com/2002Bishwajeet/mcp-gateway, docs/ARCHITECTURE.md, "Per-MCP contract").
import type { IncomingMessage, RequestListener, ServerResponse } from 'node:http';

/** Larger than any MCP call needs: a 5 MB image as a base64 data: URI is about 6.7 MB. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

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
 * neither Host nor X-Forwarded-* is ever trusted. Bodies over `limit` get 413 before the app sees them.
 */
export function nodeListener(fetchApp: (request: Request) => Promise<Response>, origin: string, limit = MAX_BODY_BYTES): RequestListener {
    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const method = req.method ?? 'GET';
        let body: Uint8Array<ArrayBuffer> | undefined;
        if (method !== 'GET' && method !== 'HEAD') {
            try {
                body = await readBody(req, limit);
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
        const { pathname, search } = new URL(req.url ?? '/', 'http://localhost');
        const response = await fetchApp(new Request(origin + pathname + search, { method, headers, body, redirect: 'manual' }));
        const out: Record<string, string | string[]> = {};
        response.headers.forEach((value, name) => {
            if (name !== 'set-cookie') out[name] = value;
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length) out['set-cookie'] = cookies;
        res.writeHead(response.status, out).end(Buffer.from(await response.arrayBuffer()));
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
