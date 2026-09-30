import { ShortcutList } from "@/components/modals";

export default function ShortcutsSection() {
  // Group titles take the settings h3 style (see SectionHeader).
  return (
    <ShortcutList className="gap-x-10 gap-y-8 [&_h3]:mb-3 [&_h3]:font-serif [&_h3]:text-lg [&_h3]:leading-snug [&_h3]:font-normal [&_h3]:tracking-tight" />
  );
}
