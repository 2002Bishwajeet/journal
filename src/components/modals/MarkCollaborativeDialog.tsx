import { useState, useCallback, useEffect } from 'react';
import { Users, ExternalLink, Loader2, Check, AlertTriangle } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDotYouClientContext } from '@/components/auth';
import { useCircles } from '@/hooks/circles/useCircles';
import { useMissingPermissions } from '@/hooks/auth/useMissingPermissions';
import { NotesDriveProvider } from '@/lib/homebase/NotesDriveProvider';
import { 
    JOURNAL_APP_ID, 
    JOURNAL_APP_NAME, 
    COLLABORATION_PERMISSIONS 
} from '@/lib/homebase/config';
import { journalDriveRequest } from '@/hooks/auth/useYouAuthAuthorization';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import type { CircleDefinition } from '@homebase-id/js-lib/network';
import { CircleOption } from '@/components/circles/CircleOption';

interface MarkCollaborativeDialogProps {
    isOpen: boolean;
    onClose: () => void;
    noteId: string;
    noteTitle: string;
    onSuccess?: () => void;
}

interface SelectedCircle {
    circleId: string;
    members: string[];
}

export function MarkCollaborativeDialog({
    isOpen,
    onClose,
    noteId,
    noteTitle,
    onSuccess,
}: MarkCollaborativeDialogProps) {
    const queryClient = useQueryClient();
    const dotYouClient = useDotYouClientContext();
    const { fetch: circlesFetch } = useCircles(true); // exclude system circles
    const [selectedCircles, setSelectedCircles] = useState<SelectedCircle[]>([]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Build return URL with noteId for reopening dialog after permission grant
    const returnUrl = `${window.location.origin}${window.location.pathname}?action=collaborate&noteId=${noteId}`;

    // Check for missing permissions with custom return URL
    const extendPermissionUrl = useMissingPermissions({
        appId: JOURNAL_APP_ID,
        drives: [journalDriveRequest],
        permissions: COLLABORATION_PERMISSIONS,
        circleDrives: [journalDriveRequest],
        needsAllConnected: false,
        returnUrl,
    });

    const hasMissingPermissions = !!extendPermissionUrl;
    const circles: CircleDefinition[] = circlesFetch.data || [];
    const isLoading = circlesFetch.isLoading;

    // Reset selection when dialog closes
    useEffect(() => {
        if (!isOpen) {
            setSelectedCircles([]);
        }
    }, [isOpen]);

    const handleCircleSelect = useCallback((circle: CircleDefinition, members: string[]) => {
        setSelectedCircles(prev => {
            const existing = prev.find(c => c.circleId === circle.id);
            if (existing) {
                // Deselect
                return prev.filter(c => c.circleId !== circle.id);
            } else {
                // Select with members
                return [...prev, { circleId: circle.id!, members }];
            }
        });
    }, []);

    const handleSubmit = useCallback(async () => {
        if (selectedCircles.length === 0) {
            toast.error('Please select at least one circle');
            return;
        }

        if (!dotYouClient) {
            toast.error('Not authenticated');
            return;
        }

        setIsSubmitting(true);
        try {
            // Extract circleIds and unique recipients from selected circles
            const circleIds = selectedCircles.map(c => c.circleId);
            const allMembers = selectedCircles.flatMap(c => c.members);
            const recipients = [...new Set(allMembers)].filter(Boolean);

            const provider = new NotesDriveProvider(dotYouClient);
            const editorOdinId = dotYouClient.getHostIdentity() || '';
            
            await provider.makeNoteCollaborative(noteId, circleIds, recipients, editorOdinId);
            
            toast.success('Note is now collaborative');
            onSuccess?.();
            onClose();
        } catch (err) {
            console.error('Failed to make note collaborative:', err);
            toast.error('Failed to make note collaborative');
        } finally {
            setIsSubmitting(false);
        }
    }, [dotYouClient, noteId, selectedCircles, onClose, onSuccess]);

    const selectedCircleIds = selectedCircles.map(c => c.circleId);

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <div className="mx-auto bg-secondary p-3 rounded-full mb-4 w-fit">
                        <Users className="h-6 w-6 text-primary" />
                    </div>
                    <DialogTitle className="text-center text-xl">
                        Mark as Collaborative
                    </DialogTitle>
                    <DialogDescription className="text-center pt-2">
                        Share "{noteTitle || 'Untitled'}" with selected circles
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    {/* Permission Warning */}
                    {hasMissingPermissions ? (
                        <div className="space-y-4">
                            <Alert variant="destructive">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertDescription>
                                    {JOURNAL_APP_NAME} needs additional permissions to enable collaboration.
                                </AlertDescription>
                            </Alert>
                            
                            <Button asChild className="w-full" size="lg">
                                <a href={extendPermissionUrl}
                                  onClick={() => {
                                    // Store noteId in localStorage as backup for redirect
                                    localStorage.setItem('pendingCollaborativeNoteId', noteId);
                                    queryClient.invalidateQueries({ queryKey: ['security-context'], exact: false });
                                  }}
                                className="flex items-center gap-2">
                                    Grant Permissions <ExternalLink className="h-4 w-4" />
                                </a>
                            </Button>
                        </div>
                    ) : (
                        <>
                            {/* Circle Info */}
                            <Alert>
                                <Users className="h-4 w-4" />
                                <AlertDescription>
                                    Members of selected circles will be able to view and edit this note.
                                </AlertDescription>
                            </Alert>

                            {/* Circle Selection */}
                            <div className="space-y-2">
                                <Label className="text-sm font-medium">Select Circles</Label>
                                
                                {isLoading ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                    </div>
                                ) : circles.length === 0 ? (
                                    <div className="text-center py-6 text-muted-foreground text-sm">
                                        No circles available. Create circles in your owner console.
                                    </div>
                                ) : (
                                    <ScrollArea className="h-56 rounded-md border p-2">
                                        <div className="space-y-2">
                                            {circles.map((circle) => (
                                                <CircleOption
                                                    key={circle.id}
                                                    circle={circle}
                                                    isActive={selectedCircleIds.includes(circle.id!)}
                                                    onSelect={handleCircleSelect}
                                                />
                                            ))}
                                        </div>
                                    </ScrollArea>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2 pt-2">
                                <Button
                                    variant="outline"
                                    className="flex-1"
                                    onClick={onClose}
                                    disabled={isSubmitting}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    className="flex-1"
                                    onClick={handleSubmit}
                                    disabled={isSubmitting || selectedCircles.length === 0}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Sharing...
                                        </>
                                    ) : (
                                        <>
                                            <Check className="mr-2 h-4 w-4" />
                                            Share with {selectedCircles.length || 0} circle{selectedCircles.length !== 1 ? 's' : ''}
                                        </>
                                    )}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
