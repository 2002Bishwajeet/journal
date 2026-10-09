import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDeviceType } from "@/hooks";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./sections";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  // Keeps the last-selected section for the life of the app (this component
  // stays mounted; only the Dialog's `open` prop toggles).
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(
    SETTINGS_SECTIONS[0].id
  );
  const isMobile = useDeviceType() === "mobile";
  const sections = SETTINGS_SECTIONS.filter((s) => !(isMobile && s.desktopOnly));
  // A desktop-only section picked before shrinking to phone width falls back to the first.
  const currentSection = sections.some((s) => s.id === activeSection)
    ? activeSection
    : sections[0].id;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* `settings-dialog` scopes this dialog's token overrides (see src/index.css).
          On phones the close button grows to a 44px touch target. */}
      <DialogContent className="settings-dialog sm:max-w-[900px] p-0 gap-0 overflow-hidden border-0 shadow-2xl bg-background max-md:[&>[data-slot=dialog-close]]:top-1.5 max-md:[&>[data-slot=dialog-close]]:right-1.5 max-md:[&>[data-slot=dialog-close]]:p-3.5">
        <DialogDescription className="sr-only">
          Manage your application preferences and data.
        </DialogDescription>

        {/* Fixed height lives here, not on DialogContent: DialogContent is a
            grid, so an h-full child would grow with its content and never scroll. */}
        <Tabs
          value={currentSection}
          onValueChange={(value) => setActiveSection(value as SettingsSectionId)}
          orientation="vertical"
          activationMode="automatic"
          className="flex flex-col md:flex-row gap-0 h-[min(640px,85dvh)] min-w-0"
        >
          {/* ── Navigation: a strip under the title on phones, a left rail from md ── */}
          <nav className="flex min-w-0 shrink-0 flex-col border-b border-border/60 bg-muted/30 md:w-56 md:overflow-y-auto md:border-b-0 md:border-r">
            {/* pr-12 and pb-2 on phones keep the title and tab strip clear of the dialog's close button. */}
            <div className="pl-5 pr-12 pt-4 pb-2 md:px-6 md:pt-7 md:pb-5">
              <DialogTitle className="font-serif text-xl font-normal tracking-tight text-foreground md:text-2xl">
                Settings
              </DialogTitle>
              <div className="mt-2 hidden h-0.5 w-8 rounded-full bg-primary md:block" />
            </div>

            <TabsList className="scrollbar-hide h-auto w-full flex-row items-stretch justify-start gap-1 overflow-x-auto rounded-none bg-transparent px-1.5 py-2 md:flex-col md:gap-0.5 md:overflow-visible md:px-3 md:py-0 md:pb-6">
              {sections.map((section) => {
                const Icon = section.icon;
                return (
                  <TabsTrigger
                    key={section.id}
                    value={section.id}
                    className="group relative h-auto min-h-11 flex-none justify-start gap-2.5 rounded-lg border-0 px-3.5 py-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground data-[state=inactive]:hover:bg-foreground/5 data-[state=active]:bg-foreground/8 data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-foreground/10 md:min-h-10 md:w-full md:gap-3"
                  >
                    {/* Active marker: the same short rule as under the title. */}
                    <span
                      aria-hidden="true"
                      className="absolute left-0 top-1/2 hidden h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary md:group-data-[state=active]:block"
                    />
                    <Icon className="h-4 w-4 shrink-0" />
                    {section.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </nav>

          {/* ── Content Area ── */}
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            style={{ scrollbarGutter: "stable" }}
          >
            {sections.map((section) => (
              <TabsContent
                key={section.id}
                value={section.id}
                className="px-5 pb-8 pt-6 outline-none md:px-10 md:pb-10 md:pt-7"
              >
                <h2 className="mb-8 font-serif text-2xl tracking-tight text-balance">
                  {section.label}
                </h2>
                <section.Component />
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
