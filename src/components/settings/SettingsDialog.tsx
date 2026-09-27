import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Monitor, Sparkles, Database, Info, ChevronRight } from "lucide-react";
import KeyboardShortcutsModal from "@/components/modals/KeyboardShortcutsModal";
import AppearanceSection from "./sections/AppearanceSection";
import AISection from "./sections/AISection";
import DataSection from "./sections/DataSection";
import AboutSection from "./sections/AboutSection";

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = "general" | "ai" | "data" | "about";

const NAV_ITEMS: { id: SettingsTab; label: string; icon: typeof Monitor }[] = [
  { id: "general", label: "General", icon: Monitor },
  { id: "ai", label: "AI & Models", icon: Sparkles },
  { id: "data", label: "Data & Security", icon: Database },
  { id: "about", label: "About", icon: Info },
];

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [showShortcuts, setShowShortcuts] = useState(false);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-[900px] p-0 gap-0 overflow-hidden border-0 shadow-2xl bg-background">
        {/* Accessible but visually hidden title */}
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Manage your application preferences and data.
        </DialogDescription>

        <div className="flex flex-col md:flex-row h-[640px] sm:max-h-[80vh]">
          {/* ── Navigation Sidebar ── */}
          <nav className="shrink-0 w-full md:w-56 border-b md:border-b-0 md:border-r border-border/60 flex flex-row md:flex-col overflow-x-auto md:overflow-y-auto bg-muted/30">
            {/* Header area */}
            <div className="hidden md:block px-6 pt-7 pb-5">
              <h2
                className="text-2xl tracking-tight text-foreground"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                Settings
              </h2>
              <div
                className="mt-2 w-8 h-[2px] rounded-full"
                style={{ background: "#B8860B" }}
              />
            </div>

            {/* Nav items */}
            <div className="flex flex-row md:flex-col px-3 md:px-3 py-2 md:py-0 md:pb-6 gap-0.5 w-full">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTab(item.id)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-colors text-left w-full group",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-4 w-4 transition-colors",
                        isActive
                          ? "text-[#B8860B]"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}
                    />
                    <span className="font-medium">{item.label}</span>
                    {isActive && (
                      <ChevronRight className="h-3 w-3 ml-auto text-[#B8860B] hidden md:block" />
                    )}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* ── Content Area ── */}
          <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ scrollbarGutter: 'stable' }}>
            {activeTab === "general" && <AppearanceSection />}
            {activeTab === "ai" && <AISection />}
            {activeTab === "data" && <DataSection />}
            {activeTab === "about" && (
              <AboutSection onOpenShortcuts={() => setShowShortcuts(true)} />
            )}
          </div>
        </div>
      </DialogContent>

      <KeyboardShortcutsModal
        isOpen={showShortcuts}
        onClose={() => setShowShortcuts(false)}
      />
    </Dialog>
  );
}
