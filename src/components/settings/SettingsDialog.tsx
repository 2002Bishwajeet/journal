import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useDeviceType } from "@/hooks";
import { overlayDepth, useOverlayHistory } from "@/hooks/useOverlayHistory";
import { OPEN_SETTINGS_EVENT } from "@/hooks/useSettingsOpener";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "./sections";
import MobileSettings from "./MobileSettings";

interface SettingsDialogProps {
  isOpen: boolean;
  /** Section to show each time the dialog opens; omitted keeps the last one (the list on a phone). */
  initialSection?: SettingsSectionId;
  onClose: () => void;
}

export default function SettingsDialog({ isOpen, initialSection, onClose }: SettingsDialogProps) {
  // Keeps the last-selected section for the life of the app (this component
  // stays mounted; only the Dialog's `open` prop toggles).
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(
    SETTINGS_SECTIONS[0].id
  );
  // Phone: the section page on top of the list, or null for the list (#831).
  const [mobilePage, setMobilePage] = useState<SettingsSectionId | null>(null);
  // Overlay depth when the dialog opened: the page's history entry waits for the dialog's own.
  const [baseDepth, setBaseDepth] = useState(0);
  const location = useLocation();
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setBaseDepth(overlayDepth(location.state));
      setMobilePage(initialSection ?? null);
      if (initialSection) setActiveSection(initialSection);
    }
  }
  // openSettings(section) while the dialog is already open (Account's "View", #874) switches to it.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const section = (event as CustomEvent<SettingsSectionId>).detail;
      setActiveSection(section);
      setMobilePage(section);
    };
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
  }, []);
  const isMobile = useDeviceType() === "mobile";
  const sections = SETTINGS_SECTIONS.filter((s) => !(isMobile && s.desktopOnly));

  // One history entry per level: the dialog has its own (see ui/dialog.tsx), a section page adds a second.
  useOverlayHistory(
    isOpen && isMobile && mobilePage !== null && overlayDepth(location.state) > baseDepth,
    () => setMobilePage(null),
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* `settings-dialog` scopes this dialog's token overrides (see src/index.css).
          On phones the sheet is pinned to the corner instead of centred, so an odd viewport
          width leaves no half-pixel seam, and the list has its own Done button. */}
      <DialogContent
        showCloseButton={!isMobile}
        // Full screen on a phone: no dim, or the status bar above it turns grey (see Sheet).
        overlayClassName="max-md:bg-transparent"
        className="settings-dialog max-h-none top-1/2 p-0 max-md:inset-0 max-md:translate-x-0 max-md:translate-y-0 max-md:h-dvh max-md:w-screen max-md:max-w-none sm:max-w-none max-md:rounded-none md:max-w-[min(900px,calc(100%-2rem))] gap-0 overflow-hidden border-0 shadow-2xl bg-background"
      >
        <DialogDescription className="sr-only">
          Manage your application preferences and data.
        </DialogDescription>

        {isMobile ? (
          <MobileSettings sections={sections} page={mobilePage} onPage={setMobilePage} onClose={onClose} />
        ) : (
          /* Fixed height lives here, not on DialogContent: DialogContent is a
             grid, so an h-full child would grow with its content and never scroll. */
          <Tabs
            value={activeSection}
            onValueChange={(value) => setActiveSection(value as SettingsSectionId)}
            orientation="vertical"
            activationMode="automatic"
            className="flex h-[min(640px,85dvh)] min-w-0 flex-row gap-0"
          >
            {/* ── Navigation: a left rail ── */}
            <nav className="flex w-56 min-w-0 shrink-0 flex-col overflow-y-auto border-r border-border/60 bg-muted/30">
              <div className="px-6 pb-5 pt-7">
                <DialogTitle className="font-serif text-2xl font-normal tracking-tight text-foreground">
                  Settings
                </DialogTitle>
                <div className="mt-2 h-0.5 w-8 rounded-full bg-primary" />
              </div>

              <TabsList className="h-auto w-full flex-col items-stretch justify-start gap-0.5 overflow-visible rounded-none bg-transparent px-3 py-0 pb-6">
                {sections.map((section) => {
                  const Icon = section.icon;
                  return (
                    <TabsTrigger
                      key={section.id}
                      value={section.id}
                      className="group relative h-auto min-h-10 w-full flex-none justify-start gap-3 rounded-lg border-0 px-3.5 py-2 text-left text-sm font-medium text-muted-foreground hover:text-foreground data-[state=inactive]:hover:bg-foreground/5 data-[state=active]:bg-foreground/8 data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-foreground/10"
                    >
                      {/* Active marker: the same short rule as under the title. */}
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1/2 hidden h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary group-data-[state=active]:block"
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
                  className="px-10 pb-10 pt-7 outline-none"
                >
                  <h2 className="mb-8 font-serif text-2xl tracking-tight text-balance">
                    {section.label}
                  </h2>
                  <section.Component close={onClose} />
                </TabsContent>
              ))}
            </div>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
