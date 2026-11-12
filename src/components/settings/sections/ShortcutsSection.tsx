import { ShortcutList } from "@/components/modals";
import { QuickCaptureShortcutRow } from "../QuickCaptureShortcutRow";

export default function ShortcutsSection() {
  // Group titles take the settings h3 style (see SectionHeader).
  return (
    <div className="space-y-8">
      <QuickCaptureShortcutRow />
      <ShortcutList className="gap-x-10 gap-y-8 [&_h3]:mb-3 [&_h3]:font-serif [&_h3]:text-lg [&_h3]:leading-snug [&_h3]:font-normal [&_h3]:tracking-tight" />
    </div>
  );
}
