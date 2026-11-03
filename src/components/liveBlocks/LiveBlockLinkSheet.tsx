/**
 * Where a link from a live block the user may not have written goes, before it opens (#975):
 * a bottom sheet on a phone, a dialog on desktop. A block can draw a fake sign-in form and
 * put what is typed in it into a link's URL, so the sheet shows the host large and the whole
 * URL under it, query and all.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';

interface LiveBlockLinkSheetProps {
  /** The link the block asked to open (an http(s) or mailto URL), or null when none is waiting. */
  url: string | null;
  onClose: () => void;
  onOpen: (url: string) => void;
}

export function LiveBlockLinkSheet({ url, onClose, onOpen }: LiveBlockLinkSheetProps) {
  // The last link, so the sheet keeps it while it slides away.
  const [shown, setShown] = useState(url);
  if (url && url !== shown) setShown(url);
  const target = shown ? new URL(shown) : null;
  // A mail link has no host: the address it writes to is what matters.
  const where = target ? (target.protocol === 'mailto:' ? target.pathname : target.host) : '';
  const buttonClass = 'h-11 touch-manipulation select-none active:scale-[0.97] md:pointer-fine:h-9';

  return (
    <ResponsiveSheet
      open={url !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Open this link?"
      description="A block in this note wants to open a link. Someone else may have written it, so check where it goes."
      dialogClassName="sm:max-w-md"
      footer={
        // Cancel first, so it has the focus when the sheet opens; on a phone it is the lower button.
        <div className="flex gap-2 max-sm:flex-col-reverse sm:justify-end">
          <Button variant="outline" className={buttonClass} onClick={onClose}>
            Cancel
          </Button>
          <Button
            className={buttonClass}
            onClick={() => {
              if (url) onOpen(url);
              onClose();
            }}
          >
            Open link
          </Button>
        </div>
      }
    >
      {target && (
        <div className="flex flex-col gap-1 rounded-md border bg-muted/40 px-3 py-2.5">
          <div className="break-all text-base font-semibold">{where}</div>
          {/* The whole URL: a query can carry what was typed in the block. Long ones scroll. */}
          <div className="max-h-32 overflow-y-auto break-all font-mono text-xs text-muted-foreground">
            {target.href}
          </div>
        </div>
      )}
    </ResponsiveSheet>
  );
}
