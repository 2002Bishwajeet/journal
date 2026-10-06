import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { ChangelogEntry } from '@/lib/changelog';

interface WhatsNewDialogProps {
  entries: ChangelogEntry[];
  onClose: () => void;
}

export default function WhatsNewDialog({ entries, onClose }: WhatsNewDialogProps) {
  return (
    <Dialog open={entries.length > 0} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>What's new</DialogTitle>
          <DialogDescription>Changes in the latest versions of Journal.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 overflow-y-auto pr-1">
          {entries.map((entry) => (
            <section key={entry.version} className="space-y-2">
              <h3 className="text-sm font-semibold">
                v{entry.version}
                {entry.date && <span className="ml-2 font-normal text-muted-foreground">{entry.date}</span>}
              </h3>
              {Object.entries(entry.sections).map(([name, items]) => (
                <div key={name} className="space-y-1">
                  <h4 className="text-xs font-medium text-muted-foreground">{name}</h4>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
