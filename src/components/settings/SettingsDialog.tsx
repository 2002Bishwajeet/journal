import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChevronRight } from "lucide-react";
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

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[900px] p-0 gap-0 overflow-hidden border-0 shadow-2xl bg-background">
        <DialogDescription className="sr-only">
          Manage your application preferences and data.
        </DialogDescription>

        {/* Fixed height lives here, not on DialogContent: DialogContent is a
            grid, so an h-full child would grow with its content and never scroll. */}
        <Tabs
          value={activeSection}
          onValueChange={(value) => setActiveSection(value as SettingsSectionId)}
          orientation="vertical"
          activationMode="automatic"
          className="flex flex-col md:flex-row gap-0 h-[min(640px,85dvh)] min-w-0"
        >
          {/* ── Navigation Sidebar ── */}
          <nav className="shrink-0 w-full md:w-56 border-b md:border-b-0 md:border-r border-border/60 flex flex-row md:flex-col overflow-x-auto md:overflow-y-auto bg-muted/30">
            <div className="hidden md:block px-6 pt-7 pb-5">
              <DialogTitle className="text-2xl font-serif font-normal tracking-tight text-foreground">
                Settings
              </DialogTitle>
              <div className="mt-2 w-8 h-[2px] rounded-full bg-primary" />
            </div>

            <TabsList className="h-auto w-full flex-row md:flex-col items-stretch justify-start gap-0.5 rounded-none bg-transparent px-3 py-2 md:py-0 md:pb-6">
              {SETTINGS_SECTIONS.map((section) => {
                const Icon = section.icon;
                return (
                  <TabsTrigger
                    key={section.id}
                    value={section.id}
                    className="group h-auto min-h-11 md:min-h-0 md:w-full flex-none justify-start gap-3 rounded-lg border-0 px-4 py-2.5 text-left text-sm font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                  >
                    <Icon className="h-4 w-4 shrink-0 group-data-[state=active]:text-primary" />
                    {section.label}
                    <ChevronRight className="ml-auto hidden h-3 w-3 text-primary md:group-data-[state=active]:block" />
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </nav>

          {/* ── Content Area ── */}
          <div className="min-h-0 flex-1 overflow-y-auto" style={{ scrollbarGutter: "stable" }}>
            {SETTINGS_SECTIONS.map((section) => (
              <TabsContent key={section.id} value={section.id} className="p-6 md:p-8 outline-none">
                <h2 className="mb-8 text-lg font-semibold">{section.label}</h2>
                <section.Component />
              </TabsContent>
            ))}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
