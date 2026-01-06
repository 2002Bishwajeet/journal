import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface ConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  noteTitle: string;
  localModified: string;
  remoteModified: string;
  onKeepLocal: () => void;
  onKeepRemote: () => void;
  onMerge: () => void;
}

export default function ConflictModal({
  isOpen,
  onClose,
  noteTitle,
  localModified,
  remoteModified,
  onKeepLocal,
  onKeepRemote,
  onMerge,
}: ConflictModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            <DialogTitle>Sync Conflict</DialogTitle>
          </div>
          <DialogDescription>
            The note "{noteTitle}" was modified on another device.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Local version:</span>
            <span>{new Date(localModified).toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Remote version:</span>
            <span>{new Date(remoteModified).toLocaleString()}</span>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onKeepLocal}>
            Keep Local
          </Button>
          <Button variant="outline" onClick={onKeepRemote}>
            Keep Remote
          </Button>
          <Button onClick={onMerge}>
            Merge Both
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
