/**
 * DocumentBroadcast Unit Tests
 * 
 * Tests the DocumentBroadcast singleton for cross-tab/component communication.
 * Uses mocked BroadcastChannel since it's not available in Node.js test environment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock BroadcastChannel since it's not available in Node.js
class MockBroadcastChannel {
    private static channels: Map<string, MockBroadcastChannel[]> = new Map();
    public onmessage: ((event: { data: unknown }) => void) | null = null;
    private channelName: string;
    private closed = false;

    constructor(name: string) {
        this.channelName = name;
        const channels = MockBroadcastChannel.channels.get(name) || [];
        channels.push(this);
        MockBroadcastChannel.channels.set(name, channels);
    }

    postMessage(data: unknown): void {
        if (this.closed) return;

        const channels = MockBroadcastChannel.channels.get(this.channelName) || [];
        // Broadcast to all OTHER channels with the same name
        for (const channel of channels) {
            if (channel !== this && channel.onmessage && !channel.closed) {
                // Simulate async behavior
                setTimeout(() => channel.onmessage?.({ data }), 0);
            }
        }
    }

    close(): void {
        this.closed = true;
        const channels = MockBroadcastChannel.channels.get(this.channelName) || [];
        const index = channels.indexOf(this);
        if (index > -1) {
            channels.splice(index, 1);
        }
    }

    static reset(): void {
        MockBroadcastChannel.channels.clear();
    }
}

// Install mock before importing the module
vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

// Import after mocking
import { DOC_BROADCAST_CHANNEL } from '@/lib/broadcast/DocumentBroadcast';

describe('DocumentBroadcast', () => {
    beforeEach(() => {
        MockBroadcastChannel.reset();
        // Reset the singleton to get a fresh instance for each test
        vi.resetModules();
    });

    afterEach(() => {
        MockBroadcastChannel.reset();
    });

    describe('Message Types', () => {
        it('should have correct channel name', () => {
            expect(DOC_BROADCAST_CHANNEL).toBe('journal-doc-updates');
        });
    });

    describe('Subscription Pattern', () => {
        it('should allow subscribing and unsubscribing', async () => {
            // Dynamically import to get fresh instance
            const { documentBroadcast } = await import('@/lib/broadcast/DocumentBroadcast');

            const handler = vi.fn();
            const unsubscribe = documentBroadcast.subscribe(handler);

            expect(typeof unsubscribe).toBe('function');

            unsubscribe();
            // After unsubscribe, handler should not be called
        });

        it('should notify subscribers of update messages', async () => {
            const { documentBroadcast } = await import('@/lib/broadcast/DocumentBroadcast');

            const handler = vi.fn();
            documentBroadcast.subscribe(handler);

            // Create another channel to simulate external message
            const externalChannel = new MockBroadcastChannel(DOC_BROADCAST_CHANNEL);
            externalChannel.postMessage({ type: 'update', docId: 'doc-123' });

            // Wait for async message delivery
            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalledWith({ type: 'update', docId: 'doc-123' });
        });

        it('should notify subscribers of flush messages', async () => {
            const { documentBroadcast } = await import('@/lib/broadcast/DocumentBroadcast');

            const handler = vi.fn();
            documentBroadcast.subscribe(handler);

            const externalChannel = new MockBroadcastChannel(DOC_BROADCAST_CHANNEL);
            externalChannel.postMessage({ type: 'flush' });

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).toHaveBeenCalledWith({ type: 'flush' });
        });
    });

    describe('Broadcast Methods', () => {
        it('should broadcast document update notification', async () => {
            const { documentBroadcast } = await import('@/lib/broadcast/DocumentBroadcast');

            const receivedMessages: unknown[] = [];
            const receiver = new MockBroadcastChannel(DOC_BROADCAST_CHANNEL);
            receiver.onmessage = (event) => receivedMessages.push(event.data);

            documentBroadcast.notifyDocumentUpdated('doc-456');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(receivedMessages).toContainEqual({ type: 'update', docId: 'doc-456' });
        });

        it('should broadcast flush request', async () => {
            const { documentBroadcast } = await import('@/lib/broadcast/DocumentBroadcast');

            const receivedMessages: unknown[] = [];
            const receiver = new MockBroadcastChannel(DOC_BROADCAST_CHANNEL);
            receiver.onmessage = (event) => receivedMessages.push(event.data);

            documentBroadcast.requestFlush();

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(receivedMessages).toContainEqual({ type: 'flush' });
        });

        it('should broadcast flush request with specific docId', async () => {
            const { documentBroadcast } = await import('@/lib/broadcast/DocumentBroadcast');

            const receivedMessages: unknown[] = [];
            const receiver = new MockBroadcastChannel(DOC_BROADCAST_CHANNEL);
            receiver.onmessage = (event) => receivedMessages.push(event.data);

            documentBroadcast.requestFlush('specific-doc');

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(receivedMessages).toContainEqual({ type: 'flush', docId: 'specific-doc' });
        });

        it('should requestFlushAndWait with delay', async () => {
            const { documentBroadcast } = await import('@/lib/broadcast/DocumentBroadcast');

            const startTime = Date.now();
            await documentBroadcast.requestFlushAndWait(undefined, 100);
            const elapsed = Date.now() - startTime;

            // Should wait at least 100ms
            expect(elapsed).toBeGreaterThanOrEqual(95); // Allow small timing variance
        });
    });

    describe('Multiple Subscribers', () => {
        it('should notify all subscribers', async () => {
            const { documentBroadcast } = await import('@/lib/broadcast/DocumentBroadcast');

            const handler1 = vi.fn();
            const handler2 = vi.fn();

            documentBroadcast.subscribe(handler1);
            documentBroadcast.subscribe(handler2);

            const externalChannel = new MockBroadcastChannel(DOC_BROADCAST_CHANNEL);
            externalChannel.postMessage({ type: 'update', docId: 'doc-multi' });

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler1).toHaveBeenCalled();
            expect(handler2).toHaveBeenCalled();
        });

        it('should stop notifying after unsubscribe', async () => {
            const { documentBroadcast } = await import('@/lib/broadcast/DocumentBroadcast');

            const handler = vi.fn();
            const unsubscribe = documentBroadcast.subscribe(handler);

            unsubscribe();

            const externalChannel = new MockBroadcastChannel(DOC_BROADCAST_CHANNEL);
            externalChannel.postMessage({ type: 'update', docId: 'doc-after-unsub' });

            await new Promise(resolve => setTimeout(resolve, 10));

            expect(handler).not.toHaveBeenCalled();
        });
    });
});
