/**
 * useImageDeletionTracker Hook
 * 
 * Tracks image payloads in a Yjs document and detects deletions.
 * Uses a 2-second cancellable timeout to support undo.
 * Triggers sync after persisting deletion to ensure server is updated.
 */

import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { savePendingImageDeletion } from '@/lib/db';
import { useSyncService } from '@/hooks/useSyncService';

// Delay before persisting deletion (allows undo)
const DELETION_DELAY_MS = 2000;

interface UseImageDeletionTrackerOptions {
    docId: string;
    yXmlFragment: Y.XmlFragment;
}

export function useImageDeletionTracker({ docId, yXmlFragment }: UseImageDeletionTrackerOptions) {
    const { syncNote } = useSyncService();

    // Track known image payloads and pending deletions with cancellable timeouts
    const knownPayloadsRef = useRef<Set<string>>(new Set());
    const pendingDeletionsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const syncNoteRef = useRef(syncNote);

    // Keep syncNote ref updated
    useEffect(() => {
        syncNoteRef.current = syncNote;
    }, [syncNote]);

    // Scan document for current image payloads
    const scanForImagePayloads = useCallback(() => {
        const currentPayloads = new Set<string>();

        const walkNode = (node: Y.XmlElement | Y.XmlFragment | Y.XmlText) => {
            if (node instanceof Y.XmlElement) {
                if (node.nodeName === 'image') {
                    try {
                        const src = node.getAttribute('src');
                        if (src && typeof src === 'string' && src.startsWith('attachment://')) {
                            const parts = src.replace('attachment://', '').split('/');
                            if (parts.length >= 2) {
                                currentPayloads.add(parts[1]);
                            }
                        }
                    } catch {
                        // Ignore errors
                    }
                }
                for (let i = 0; i < node.length; i++) {
                    const child = node.get(i);
                    if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) {
                        walkNode(child);
                    }
                }
            } else if (node instanceof Y.XmlFragment) {
                for (let i = 0; i < node.length; i++) {
                    const child = node.get(i);
                    if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) {
                        walkNode(child);
                    }
                }
            }
        };

        walkNode(yXmlFragment);
        return currentPayloads;
    }, [yXmlFragment]);

    // Initialize known payloads on mount
    useEffect(() => {
        const payloads = scanForImagePayloads();
        knownPayloadsRef.current = payloads;
        console.log(`[useImageDeletionTracker] Initialized with ${payloads.size} known payloads:`, Array.from(payloads));
    }, [scanForImagePayloads]);

    // Cleanup pending timeouts on unmount
    useEffect(() => {
        const pendingDeletions = pendingDeletionsRef.current;
        return () => {
            pendingDeletions.forEach(timeout => clearTimeout(timeout));
            pendingDeletions.clear();
        };
    }, []);

    // Observe Yjs fragment for image deletions
    useEffect(() => {
        const handleUpdate = (events: Y.YEvent<Y.XmlFragment>[]) => {
            // Check if any image node was deleted
            let imageDeleted = false;
            for (const event of events) {
                if (event.changes.deleted.size > 0) {
                    event.changes.deleted.forEach((item) => {
                        if (item.content) {
                            const contentItems = item.content.getContent();
                            for (const content of contentItems) {
                                // Check if it's an image node by nodeName
                                if (content && typeof content === 'object' && 'nodeName' in content) {
                                    const nodeName = (content as { nodeName?: string }).nodeName;
                                    if (nodeName === 'image') {
                                        console.log('[useImageDeletionTracker] Image node deletion detected');
                                        imageDeleted = true;
                                    }
                                }
                            }
                        }
                    });
                }
            }

            // Get current payloads
            const currentPayloads = scanForImagePayloads();
            const knownPayloads = knownPayloadsRef.current;

            console.debug(`[useImageDeletionTracker] Known: ${knownPayloads.size}, Current: ${currentPayloads.size}, ImageDeleted: ${imageDeleted}`);

            // Check for deletions (only if image node was deleted)
            if (imageDeleted) {
                knownPayloads.forEach(payloadKey => {
                    if (!currentPayloads.has(payloadKey)) {
                        // Check if already pending
                        if (!pendingDeletionsRef.current.has(payloadKey)) {
                            console.log(`[useImageDeletionTracker] Image removed, scheduling deletion in ${DELETION_DELAY_MS}ms: ${payloadKey}`);

                            // Schedule deletion with delay (allows undo)
                            const timeout = setTimeout(async () => {
                                console.log(`[useImageDeletionTracker] Persisting image deletion: ${payloadKey}`);
                                try {
                                    await savePendingImageDeletion(docId, payloadKey);
                                    // Trigger sync for this note to send deletion to server
                                    syncNoteRef.current?.(docId);
                                } catch (err) {
                                    console.error('[useImageDeletionTracker] Failed to save pending deletion:', err);
                                }
                                pendingDeletionsRef.current.delete(payloadKey);
                            }, DELETION_DELAY_MS);

                            pendingDeletionsRef.current.set(payloadKey, timeout);
                        }
                    }
                });
            }

            // Check for re-appearances (undo) - cancel pending deletions
            currentPayloads.forEach(payloadKey => {
                if (pendingDeletionsRef.current.has(payloadKey)) {
                    console.log(`[useImageDeletionTracker] Image re-appeared (undo?), cancelling deletion: ${payloadKey}`);
                    clearTimeout(pendingDeletionsRef.current.get(payloadKey));
                    pendingDeletionsRef.current.delete(payloadKey);
                }
            });

            // Update known payloads
            knownPayloadsRef.current = currentPayloads;
        };

        yXmlFragment.observeDeep(handleUpdate);
        return () => {
            yXmlFragment.unobserveDeep(handleUpdate);
        };
    }, [docId, yXmlFragment, scanForImagePayloads]);
}
