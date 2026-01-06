// Job types for background processing
export type JobType = 'generate_embedding' | 'action_suggestion';

export interface Job {
    id?: number;
    jobType: JobType;
    payload: Record<string, unknown>;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    errorMessage?: string;
    createdAt?: Date;
    processedAt?: Date;
}

export interface EmbeddingJobPayload {
    docId: string;
    text: string;
    [key: string]: unknown;
}

export interface ActionSuggestionJobPayload {
    docId: string;
    text: string;
    [key: string]: unknown;
}

// Worker message types
export type WorkerMessage =
    | { type: 'process_job'; job: Job }
    | { type: 'cancel_all' }
    | { type: 'get_status' };

export type WorkerResponse =
    | { type: 'job_completed'; jobId: number; result: unknown }
    | { type: 'job_failed'; jobId: number; error: string }
    | { type: 'status'; isProcessing: boolean; pendingJobs: number }
    | { type: 'ready' };
