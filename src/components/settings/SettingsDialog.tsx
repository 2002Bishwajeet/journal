import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useDeviceType } from "@/hooks/useDeviceType";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./sections";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const isMobile = useDeviceType() === "mobile";

  // Desktop keeps the last-selected section for the life of the app (this
  // component stays mounted; only the Dialog's `open` prop toggles).
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(
    SETTINGS_SECTIONS[0].id
  );

  // Mobile always starts at the section list on open. Adjusted during render
  // (rather than in an effect) per https://react.dev/learn/you-might-not-need-an-effect.
  const [mobileSectionId, setMobileSectionId] = useState<SettingsSectionId | null>(null);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setMobileSectionId(null);
  }

  const mobileSection = mobileSectionId
    ? SETTINGS_SECTIONS.find((s) => s.id === mobileSectionId)
    : undefined;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "gap-0 overflow-hidden border-0 bg-background p-0 shadow-2xl",
          "inset-0 top-0 left-0 h-dvh w-screen max-w-none translate-x-0 translate-y-0 rounded-none",
          "md:inset-auto md:top-[50%] md:left-[50%] md:h-[min(640px,85vh)] md:w-full md:max-w-[860px] md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-lg md:border"
        )}
        showCloseButton={!isMobile}
      >
        <DialogDescription className="sr-only">
          Manage your application preferences and data.
        </DialogDescription>

        {isMobile ? (
          <div className="flex h-full flex-col">
            <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border/60 px-2">
              {mobileSection ? (
                <button
                  type="button"
                  aria-label="Back to settings"
                  onClick={() => setMobileSectionId(null)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              ) : (
                <div className="w-9 shrink-0" />
              )}
              <DialogTitle className="flex-1 truncate text-center text-base font-semibold">
                {mobileSection ? mobileSection.label : "Settings"}
              </DialogTitle>
              <button
                type="button"
                aria-label="Close settings"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {mobileSection ? (
                <div className="p-6">
                  <mobileSection.Component />
                </div>
              ) : (
                <div className="divide-y divide-border/60">
                  {SETTINGS_SECTIONS.map((section) => {
                    const Icon = section.icon;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        onClick={() => setMobileSectionId(section.id)}
                        className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50"
                      >
                        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{section.label}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {section.description}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <Tabs
            value={activeSection}
            onValueChange={(value) => setActiveSection(value as SettingsSectionId)}
            orientation="vertical"
            activationMode="automatic"
            className="flex h-full flex-row gap-0"
          >
            <div className="flex h-full w-52 shrink-0 flex-col border-r border-border/60 bg-muted/30">
              <DialogTitle className="px-4 pt-6 pb-4 text-lg font-semibold text-foreground">
                Settings
              </DialogTitle>
              <TabsList className="h-auto w-full flex-1 flex-col items-stretch justify-start gap-0.5 overflow-y-auto rounded-none bg-transparent p-3">
                {SETTINGS_SECTIONS.map((section) => {
                  const Icon = section.icon;
                  return (
                    <TabsTrigger
                      key={section.id}
                      value={section.id}
                      className="h-auto w-full flex-none justify-start gap-3 rounded-lg border-0 px-3 py-2.5 text-left text-sm font-medium data-[state=active]:bg-accent data-[state=active]:shadow-none"
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {section.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto">
              {SETTINGS_SECTIONS.map((section) => (
                <TabsContent key={section.id} value={section.id} className="p-8 outline-none">
                  <h2 className="mb-8 text-lg font-semibold">{section.label}</h2>
                  <section.Component />
                </TabsContent>
              ))}
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
