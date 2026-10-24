/**
 * WebMCP detection (#705). Chrome's WebMCP API is an origin trial: `document.modelContext`,
 * which earlier drafts and some pages still call `navigator.modelContext`. This file is small
 * and static because the app checks it at boot; the tools themselves are in webmcp.ts.
 */

export interface WebMcpTool {
    name: string;
    description: string;
    inputSchema: object;
    annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
    execute(args: unknown, options?: { signal?: AbortSignal }): Promise<string>;
}

export interface ModelContext {
    /** Unregister a tool by aborting `signal`. */
    registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): Promise<unknown> | unknown;
}

/** The browser's WebMCP object, or null when the browser has none. */
export function getModelContext(): ModelContext | null {
    if (typeof document === 'undefined') return null;
    const context =
        (document as unknown as { modelContext?: ModelContext }).modelContext ??
        (navigator as unknown as { modelContext?: ModelContext }).modelContext;
    return typeof context?.registerTool === 'function' ? context : null;
}

/** Adds the origin-trial token that turns WebMCP on for this origin. */
export function addOriginTrialToken(token: string | undefined): void {
    if (!token) return;
    const meta = document.createElement('meta');
    meta.httpEquiv = 'origin-trial';
    meta.content = token;
    document.head.append(meta);
}
