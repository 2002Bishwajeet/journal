/**
 * WebSocketProcessQueue Unit Tests
 *
 * Tests deduplication, debouncing, drain, and destroy behavior.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocketProcessQueue } from '@/lib/sync/WebSocketProcessQueue';
import type { ClientFileNotification } from '@homebase-id/js-lib/core';

/**
 * Helper to create a mock ClientFileNotification.
 */
function createNotification(
    uniqueId: string,
    versionTag: string,
    updated: number,
    notificationType: 'fileAdded' | 'fileModified' | 'fileDeleted' = 'fileModified',
    fileType: number = 101,
): ClientFileNotification {
    return {
        notificationType,
        targetDrive: { alias: 'test', type: 'test' },
        header: {
            fileId: `file-${uniqueId}`,
            fileState: 'active',
            fileMetadata: {
                versionTag,
                updated,
                appData: {
                    uniqueId,
                    fileType,
                    content: '',
                },
                isEncrypted: false,
                created: 0,
                senderOdinId: '',
                originalAuthor: '',
                payloads: [],
            },
            sharedSecretEncryptedKeyHeader: {} as any,
            fileSystemType: 'Standard',
            priority: 0,
            serverMetadata: {
                accessControlList: { requiredSecurityGroup: 'owner' },
                allowDistribution: false,
                doNotIndex: false,
            },
        },
    } as unknown as ClientFileNotification;
}

describe('WebSocketProcessQueue', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('Deduplication', () => {
        it('should process only the latest notification for the same uniqueId', async () => {
            const processed: string[] = [];
            const queue = new WebSocketProcessQueue(async (notification) => {
                processed.push(notification.header?.fileMetadata?.versionTag ?? '');
            });

            queue.enqueue(createNotification('doc-1', 'v1', 1000));
            queue.enqueue(createNotification('doc-1', 'v2', 2000));
            queue.enqueue(createNotification('doc-1', 'v3', 3000));

            // Flush by advancing past debounce
            await vi.advanceTimersByTimeAsync(700);

            expect(processed).toEqual(['v3']);
            queue.destroy();
        });

        it('should skip notifications with identical versionTag and updated', async () => {
            const processed: string[] = [];
            const queue = new WebSocketProcessQueue(async (notification) => {
                processed.push(notification.header?.fileMetadata?.appData?.uniqueId ?? '');
            });

            queue.enqueue(createNotification('doc-1', 'v1', 1000));
            queue.enqueue(createNotification('doc-1', 'v1', 1000)); // exact duplicate

            await vi.advanceTimersByTimeAsync(700);

            expect(processed).toEqual(['doc-1']); // processed only once
            queue.destroy();
        });

        it('should ignore older notifications for the same uniqueId', async () => {
            const processed: string[] = [];
            const queue = new WebSocketProcessQueue(async (notification) => {
                processed.push(notification.header?.fileMetadata?.versionTag ?? '');
            });

            queue.enqueue(createNotification('doc-1', 'v2', 2000)); // newer first
            queue.enqueue(createNotification('doc-1', 'v1', 1000)); // older arrives later

            await vi.advanceTimersByTimeAsync(700);

            expect(processed).toEqual(['v2']); // kept the newer one
            queue.destroy();
        });
    });

    describe('Multiple files', () => {
        it('should process all distinct uniqueIds', async () => {
            const processed: string[] = [];
            const queue = new WebSocketProcessQueue(async (notification) => {
                processed.push(notification.header?.fileMetadata?.appData?.uniqueId ?? '');
            });

            queue.enqueue(createNotification('doc-1', 'v1', 1000));
            queue.enqueue(createNotification('doc-2', 'v1', 1000));
            queue.enqueue(createNotification('doc-3', 'v1', 1000));

            await vi.advanceTimersByTimeAsync(700);

            expect(processed).toHaveLength(3);
            expect(processed).toContain('doc-1');
            expect(processed).toContain('doc-2');
            expect(processed).toContain('doc-3');
            queue.destroy();
        });
    });

    describe('Debounce', () => {
        it('should NOT process before debounce window expires', async () => {
            const processed: string[] = [];
            const queue = new WebSocketProcessQueue(async (notification) => {
                processed.push(notification.header?.fileMetadata?.appData?.uniqueId ?? '');
            });

            queue.enqueue(createNotification('doc-1', 'v1', 1000));
            await vi.advanceTimersByTimeAsync(500); // 500ms < 700ms

            expect(processed).toHaveLength(0);
            queue.destroy();
        });

        it('should reset debounce timer when new items arrive', async () => {
            const processed: string[] = [];
            const queue = new WebSocketProcessQueue(async (notification) => {
                processed.push(notification.header?.fileMetadata?.appData?.uniqueId ?? '');
            });

            queue.enqueue(createNotification('doc-1', 'v1', 1000));
            await vi.advanceTimersByTimeAsync(500); // 500ms

            // New item resets the timer
            queue.enqueue(createNotification('doc-2', 'v1', 1000));
            await vi.advanceTimersByTimeAsync(500); // only 500ms since reset, total 1000ms

            expect(processed).toHaveLength(0); // still not flushed

            await vi.advanceTimersByTimeAsync(200); // 700ms since last enqueue

            expect(processed).toHaveLength(2);
            queue.destroy();
        });

        it('should support custom debounce time', async () => {
            const processed: string[] = [];
            const queue = new WebSocketProcessQueue(async (notification) => {
                processed.push(notification.header?.fileMetadata?.appData?.uniqueId ?? '');
            }, 200); // 200ms

            queue.enqueue(createNotification('doc-1', 'v1', 1000));
            await vi.advanceTimersByTimeAsync(200);

            expect(processed).toHaveLength(1);
            queue.destroy();
        });
    });

    describe('drain()', () => {
        it('should process all queued items immediately', async () => {
            const processed: string[] = [];
            const queue = new WebSocketProcessQueue(async (notification) => {
                processed.push(notification.header?.fileMetadata?.appData?.uniqueId ?? '');
            });

            queue.enqueue(createNotification('doc-1', 'v1', 1000));
            queue.enqueue(createNotification('doc-2', 'v1', 1000));

            await queue.drain();

            expect(processed).toHaveLength(2);
            expect(queue.size).toBe(0);
            queue.destroy();
        });

        it('should clear the debounce timer', async () => {
            const processed: string[] = [];
            const queue = new WebSocketProcessQueue(async (notification) => {
                processed.push(notification.header?.fileMetadata?.appData?.uniqueId ?? '');
            });

            queue.enqueue(createNotification('doc-1', 'v1', 1000));
            await queue.drain();

            // Advance timer — should NOT double-process
            await vi.advanceTimersByTimeAsync(700);

            expect(processed).toHaveLength(1);
            queue.destroy();
        });
    });

    describe('destroy()', () => {
        it('should clear timers and discard queued items', async () => {
            const processed: string[] = [];
            const queue = new WebSocketProcessQueue(async (notification) => {
                processed.push(notification.header?.fileMetadata?.appData?.uniqueId ?? '');
            });

            queue.enqueue(createNotification('doc-1', 'v1', 1000));
            queue.destroy();

            // Advance past debounce
            await vi.advanceTimersByTimeAsync(700);

            expect(processed).toHaveLength(0);
            expect(queue.size).toBe(0);
        });
    });

    describe('Missing uniqueId', () => {
        it('should skip notifications without uniqueId', async () => {
            const processed: string[] = [];
            const queue = new WebSocketProcessQueue(async (_notification) => {
                processed.push('processed');
            });

            // Create a notification with no uniqueId
            const notification = createNotification('', 'v1', 1000);
            notification.header!.fileMetadata!.appData!.uniqueId = undefined as any;

            queue.enqueue(notification);
            await vi.advanceTimersByTimeAsync(700);

            expect(processed).toHaveLength(0);
            queue.destroy();
        });
    });

    describe('Processing errors', () => {
        it('should continue processing other items if one fails', async () => {
            const processed: string[] = [];
            let callCount = 0;
            const queue = new WebSocketProcessQueue(async (notification) => {
                callCount++;
                if (callCount === 1) {
                    throw new Error('Processing failed');
                }
                processed.push(notification.header?.fileMetadata?.appData?.uniqueId ?? '');
            });

            queue.enqueue(createNotification('doc-1', 'v1', 1000));
            queue.enqueue(createNotification('doc-2', 'v1', 1000));

            await vi.advanceTimersByTimeAsync(700);

            // doc-1 failed, but doc-2 should still be processed
            expect(processed).toContain('doc-2');
            queue.destroy();
        });
    });
});
