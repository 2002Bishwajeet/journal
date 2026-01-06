/// <reference lib="webworker" />

import type { WorkerMessage, WorkerResponse, Job, EmbeddingJobPayload } from './types';

declare const self: DedicatedWorkerGlobalScope;

let isProcessing = false;

// Simple embedding generation using basic text features
// Note: For production, this should use WebLLM embeddings
function generateSimpleEmbedding(text: string): number[] {
    // Create a simple embedding based on word frequencies and basic features
    // This is a placeholder - real implementation would use WebLLM
    const words = text.toLowerCase().split(/\s+/);
    const wordFreq = new Map<string, number>();

    for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }

    // Create a fixed-size embedding vector (256 dimensions)
    const embedding = new Array(256).fill(0);

    let i = 0;
    for (const [word, count] of wordFreq) {
        // Simple hash function to map words to embedding dimensions
        const hash = word.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const index = hash % 256;
        embedding[index] += count / words.length;
        i++;
        if (i >= 100) break; // Limit to top 100 words
    }

    // Normalize the embedding
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
        for (let j = 0; j < embedding.length; j++) {
            embedding[j] /= magnitude;
        }
    }

    return embedding;
}

async function processJob(job: Job): Promise<unknown> {
    switch (job.jobType) {
        case 'generate_embedding': {
            const payload = job.payload as EmbeddingJobPayload;
            const embedding = generateSimpleEmbedding(payload.text);
            return { docId: payload.docId, embedding };
        }
        case 'action_suggestion': {
            // Placeholder for action suggestions
            // In production, this would use WebLLM to analyze text
            return { suggestions: [] };
        }
        default:
            throw new Error(`Unknown job type: ${job.jobType}`);
    }
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;

    switch (message.type) {
        case 'process_job': {
            if (isProcessing) {
                // Queue the job for later
                return;
            }

            isProcessing = true;
            const job = message.job;

            try {
                const result = await processJob(job);
                const response: WorkerResponse = {
                    type: 'job_completed',
                    jobId: job.id!,
                    result,
                };
                self.postMessage(response);
            } catch (error) {
                const response: WorkerResponse = {
                    type: 'job_failed',
                    jobId: job.id!,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
                self.postMessage(response);
            } finally {
                isProcessing = false;
            }
            break;
        }

        case 'get_status': {
            const response: WorkerResponse = {
                type: 'status',
                isProcessing,
                pendingJobs: 0, // Worker doesn't track pending jobs
            };
            self.postMessage(response);
            break;
        }

        case 'cancel_all': {
            // Reset processing state
            isProcessing = false;
            break;
        }
    }
};

// Signal that the worker is ready
const readyMessage: WorkerResponse = { type: 'ready' };
self.postMessage(readyMessage);
