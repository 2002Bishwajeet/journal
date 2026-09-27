/**
 * useImageDeletionTracker Hook
 * 
 * Tracks image payloads in a Yjs document and detects deletions.
 * Uses a 2-second cancellable timeout to support undo.
 * Triggers sync after persisting deletion to ensure server is updated.
 */

import { useCallback, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { getSyncRecord, savePendingImageDeletion } from '@/lib/db';
import { collectImageRefs } from '@/lib/yjs/imageRefs';
import { useSyncService } from '@/hooks/useSyncService';

// Delay before persisting deletion (allows undo)
const DELETION_DELAY_MS = 2000;

interface UseImageDeletionTrackerOptions {
    docId: string;
    yXmlFragment: Y.XmlFragment;
}

//TODO: Why is this needed?
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

    // Scan document for current image refs, keyed "<fileId>/<payloadKey>"
    const scanForImagePayloads = useCallback(() => {
        return new Set(collectImageRefs(yXmlFragment).map(({ fileId, payloadKey }) => `${fileId}/${payloadKey}`));
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
                knownPayloads.forEach(ref => {
                    if (!currentPayloads.has(ref)) {
                        // Check if already pending
                        if (!pendingDeletionsRef.current.has(ref)) {
                            console.log(`[useImageDeletionTracker] Image removed, scheduling deletion in ${DELETION_DELAY_MS}ms: ${ref}`);
                            const [fileId, payloadKey] = ref.split('/');

                            // Schedule deletion with delay (allows undo)
                            const timeout = setTimeout(async () => {
                                try {
                                    // Only this note's own payloads may be deleted: a pasted image
                                    // points at another note's file (#174)
                                    const syncRecord = await getSyncRecord(docId);
                                    if (syncRecord?.remoteFileId && fileId === syncRecord.remoteFileId) {
                                        console.log(`[useImageDeletionTracker] Persisting image deletion: ${payloadKey}`);
                                        await savePendingImageDeletion(docId, payloadKey);
                                        // Trigger sync for this note to send deletion to server
                                        syncNoteRef.current?.(docId);
                                    }
                                } catch (err) {
                                    console.error('[useImageDeletionTracker] Failed to save pending deletion:', err);
                                }
                                pendingDeletionsRef.current.delete(ref);
                            }, DELETION_DELAY_MS);

                            pendingDeletionsRef.current.set(ref, timeout);
                        }
                    }
                });
            }

            // Check for re-appearances (undo) - cancel pending deletions
            currentPayloads.forEach(ref => {
                if (pendingDeletionsRef.current.has(ref)) {
                    console.log(`[useImageDeletionTracker] Image re-appeared (undo?), cancelling deletion: ${ref}`);
                    clearTimeout(pendingDeletionsRef.current.get(ref));
                    pendingDeletionsRef.current.delete(ref);
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
