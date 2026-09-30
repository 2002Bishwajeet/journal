interface HttpErrorLike {
    response?: {
        status?: number;
    };
}

/** HTTP status of an SDK (axios) error, or undefined when there was no response. */
export function httpStatus(err: unknown): number | undefined {
    return (err as HttpErrorLike | null | undefined)?.response?.status;
}
