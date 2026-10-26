/** What a failed sync request says, in the shape the log and Diagnostics show (#874). */
export interface SyncErrorInfo {
    /** e.g. "HTTP 400: Too many Payloads count 26 in FileMetadata max 25" */
    message: string;
    status?: number;
    /** Homebase's `errorCode` from the response body, e.g. "invalidPayloadNameOrKey" */
    code?: string;
    /** A retry can't succeed: stop retrying until the user asks. */
    permanent: boolean;
}

// 4xx that a later attempt can still pass: sign-in, timeout, rate limit
const TRANSIENT_4XX = new Set([401, 408, 429]);

/**
 * Read an error from the SDK (an AxiosError) or anything else. Homebase answers a
 * rejected request with a JSON body `{ title, errorCode }`; Axios's own message
 * only has the status. A 4xx is permanent, except a sign-in, timeout or rate limit
 * and a version conflict (the next push merges and retries). 5xx and network
 * errors are transient: they back off and retry.
 */
export function describeSyncError(error: unknown): SyncErrorInfo {
    const response = (error as { response?: { status?: unknown; data?: unknown } } | null)?.response;
    const status = typeof response?.status === 'number' ? response.status : undefined;
    const data = response?.data as { title?: unknown; errorCode?: unknown } | undefined;
    const code = typeof data?.errorCode === 'string' ? data.errorCode : undefined;
    const title = typeof data?.title === 'string' ? data.title : undefined;
    const fallback = error instanceof Error ? error.message : String(error);
    const text = title ?? fallback;
    const message = status !== undefined && !text.includes(String(status)) ? `HTTP ${status}: ${text}` : text;
    const permanent =
        status !== undefined && status >= 400 && status < 500 && !TRANSIENT_4XX.has(status) && code !== 'versionTagMismatch';
    return { message, status, code, permanent };
}
