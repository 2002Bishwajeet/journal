import { getDatabase } from '../db/pglite';
import type { Job, JobType, WorkerMessage, WorkerResponse, EmbeddingJobPayload } from './types';

let worker: Worker | null = null;
let isInitialized = false;
let processingJobId: number | null = null;

// Callbacks for job completion
const jobCallbacks = new Map<number, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
}>();

/**
 * Initialize the job queue worker
 */
export async function initJobQueue(): Promise<void> {
    if (isInitialized) return;

    try {
        worker = new Worker(
            new URL('./jobQueueWorker.ts', import.meta.url),
            { type: 'module' }
        );

        worker.onmessage = handleWorkerMessage;
        worker.onerror = (error) => {
            console.error('Job queue worker error:', error);
        };

        isInitialized = true;

        // Resume any pending jobs from database
        await resumePendingJobs();
    } catch (error) {
        console.error('Failed to initialize job queue:', error);
    }
}

/**
 * Handle messages from the worker
 */
function handleWorkerMessage(event: MessageEvent<WorkerResponse>): void {
    const response = event.data;

    switch (response.type) {
        case 'ready':
            console.log('Job queue worker ready');
            break;

        case 'job_completed':
            handleJobCompleted(response.jobId, response.result);
            break;

        case 'job_failed':
            handleJobFailed(response.jobId, response.error);
            break;

        case 'status':
            // Handle status updates if needed
            break;
    }
}

/**
 * Handle successful job completion
 */
async function handleJobCompleted(jobId: number, result: unknown): Promise<void> {
    processingJobId = null;

    // Update job status in database
    const db = await getDatabase();
    await db.query(
        `UPDATE job_queue SET status = 'completed', processed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [jobId]
    );

    // Handle embedding result
    if (result && typeof result === 'object' && 'embedding' in result) {
        const { docId, embedding } = result as { docId: string; embedding: number[] };
        await db.query(
            `UPDATE search_index SET vector_embedding = $1 WHERE doc_id = $2`,
            [embedding, docId]
        );
    }

    // Resolve callback if exists
    const callback = jobCallbacks.get(jobId);
    if (callback) {
        callback.resolve(result);
        jobCallbacks.delete(jobId);
    }

    // Process next pending job
    await processNextJob();
}

/**
 * Handle job failure
 */
async function handleJobFailed(jobId: number, error: string): Promise<void> {
    processingJobId = null;

    // Update job status in database
    const db = await getDatabase();
    await db.query(
        `UPDATE job_queue SET status = 'failed', error_message = $1, processed_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [error, jobId]
    );

    // Reject callback if exists
    const callback = jobCallbacks.get(jobId);
    if (callback) {
        callback.reject(new Error(error));
        jobCallbacks.delete(jobId);
    }

    // Process next pending job
    await processNextJob();
}

/**
 * Add a job to the queue
 */
export async function addJob(jobType: JobType, payload: Record<string, unknown>): Promise<number> {
    const db = await getDatabase();
    const result = await db.query<{ id: number }>(
        `INSERT INTO job_queue (job_type, payload) VALUES ($1, $2) RETURNING id`,
        [jobType, JSON.stringify(payload)]
    );

    const jobId = result.rows[0].id;

    // If no job is currently processing, start processing
    if (!processingJobId) {
        await processNextJob();
    }

    return jobId;
}

/**
 * Queue an embedding generation job for a document
 */
export async function queueEmbeddingJob(docId: string, text: string): Promise<number> {
    const payload: EmbeddingJobPayload = { docId, text };
    return addJob('generate_embedding', payload);
}

/**
 * Process the next pending job
 */
async function processNextJob(): Promise<void> {
    if (!worker || processingJobId) return;

    const db = await getDatabase();
    const result = await db.query<{
        id: number;
        job_type: JobType;
        payload: Record<string, unknown>;
    }>(
        `SELECT id, job_type, payload FROM job_queue WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1`
    );

    if (result.rows.length === 0) return;

    const row = result.rows[0];
    const job: Job = {
        id: row.id,
        jobType: row.job_type,
        payload: row.payload,
        status: 'processing',
    };

    // Update status to processing
    await db.query(
        `UPDATE job_queue SET status = 'processing' WHERE id = $1`,
        [job.id]
    );

    processingJobId = job.id!;

    // Send job to worker
    const message: WorkerMessage = { type: 'process_job', job };
    worker.postMessage(message);
}

/**
 * Resume pending jobs on app start
 */
async function resumePendingJobs(): Promise<void> {
    const db = await getDatabase();

    // Reset any jobs that were processing when app closed
    await db.query(
        `UPDATE job_queue SET status = 'pending' WHERE status = 'processing'`
    );

    // Start processing
    await processNextJob();
}

/**
 * Get job queue status
 */
export async function getJobQueueStatus(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
}> {
    const db = await getDatabase();
    const result = await db.query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text as count FROM job_queue GROUP BY status`
    );

    const status = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of result.rows) {
        if (row.status in status) {
            status[row.status as keyof typeof status] = parseInt(row.count, 10);
        }
    }

    return status;
}

/**
 * Clear completed jobs older than specified days
 */
export async function cleanupOldJobs(daysOld: number = 7): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `DELETE FROM job_queue WHERE status IN ('completed', 'failed') AND processed_at < NOW() - INTERVAL '${daysOld} days'`
    );
}

/**
 * Check if indexing is in progress
 */
export async function isIndexingInProgress(): Promise<boolean> {
    const status = await getJobQueueStatus();
    return status.pending > 0 || status.processing > 0;
}
