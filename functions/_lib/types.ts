// Minimal local stand-ins for the Pages Functions types, so the lockfile doesn't
// need @cloudflare/workers-types or wrangler.

export interface ShareEnv {
    ASSETS: { fetch(input: Request | URL | string): Promise<Response> };
    /** Set only by the e2e edge harness (`--binding`); never in production. */
    HOMEBASE_UPSTREAM_OVERRIDE?: string;
}

export interface ShareContext {
    request: Request;
    env: ShareEnv;
    waitUntil(promise: Promise<unknown>): void;
    next(): Promise<Response>;
}
