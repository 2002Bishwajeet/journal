import { Download, Info, MemoryStick, MonitorCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { PendingDownload } from '@/hooks/useModelDownloadGate';

interface ModelDownloadDialogProps {
  pending: PendingDownload | null;
  onContinue: () => void;
  onCancel: () => void;
}

/** A calm note: what to know about this device. Not an error. */
function Notice({ text }: { text: string }) {
  return (
    <p className="flex gap-2.5 rounded-md border border-border bg-muted/50 p-3 text-sm text-foreground">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span>{text}</span>
    </p>
  );
}

/**
 * Before a model downloads (#695): its download size, the memory it uses and what it needs, one
 * per line, and anything to be careful about on this device. An unsupported device gets a notice
 * and only "Got it".
 */
export default function ModelDownloadDialog({ pending, onContinue, onCancel }: ModelDownloadDialogProps) {
  if (!pending) return null;
  const { model, result } = pending;
  const unsupported = result.verdict === 'unsupported';
  const facts = [
    { Icon: Download, text: <>Downloads <strong className="font-semibold tabular-nums">{model.downloadSize}</strong>.</> },
    { Icon: MemoryStick, text: <>Uses <strong className="font-semibold tabular-nums">{model.memoryUsage}</strong> of memory while it runs.</> },
    { Icon: MonitorCheck, text: 'Needs WebGPU and a desktop browser.' },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{unsupported ? "AI isn't available here" : `Download ${model.name}?`}</DialogTitle>
          {/* A div, so the list and the notice are both the dialog's description. */}
          <DialogDescription asChild>
            <div className="flex flex-col gap-3">
              {!unsupported && (
                <ul className="mt-2 flex flex-col gap-2 text-foreground">
                  {facts.map(({ Icon, text }, i) => (
                    <li key={i} className="flex items-center gap-2.5">
                      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
              )}
              {result.reasons.length > 0 && <Notice text={result.reasons.join(' ')} />}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant={unsupported ? 'default' : 'outline'} onClick={onCancel}>
            {unsupported ? 'Got it' : 'Cancel'}
          </Button>
          {!unsupported && <Button onClick={onContinue}>Continue</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
