import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Monitor, Sparkles, Database, Info, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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
      <DialogContent
        className="sm:max-w-[900px] p-0 gap-0 overflow-hidden border-0 shadow-2xl"
        style={{
          background:
            "linear-gradient(135deg, var(--card) 0%, var(--background) 100%)",
        }}
      >
        {/* Accessible but visually hidden title */}
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Manage your application preferences and data.
        </DialogDescription>

        <div className="flex flex-col md:flex-row h-[640px] sm:max-h-[80vh]">
          {/* ── Navigation Sidebar ── */}
          <nav
            className="shrink-0 w-full md:w-56 border-b md:border-b-0 md:border-r border-border/60 flex flex-row md:flex-col overflow-x-auto md:overflow-y-auto"
            style={{
              background:
                "linear-gradient(180deg, var(--secondary) 0%, transparent 100%)",
            }}
          >
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
                      "relative flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-all duration-200 text-left w-full group",
                      isActive
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="settings-nav-active"
                        className="absolute inset-0 rounded-lg"
                        style={{
                          background:
                            "linear-gradient(135deg, rgba(184, 134, 11, 0.08) 0%, rgba(184, 134, 11, 0.03) 100%)",
                          border: "1px solid rgba(184, 134, 11, 0.15)",
                        }}
                        transition={{
                          type: "spring",
                          stiffness: 380,
                          damping: 30,
                        }}
                      />
                    )}
                    <Icon
                      className={cn(
                        "h-4 w-4 relative z-10 transition-colors",
                        isActive
                          ? "text-[#B8860B]"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}
                    />
                    <span className="relative z-10 font-medium">
                      {item.label}
                    </span>
                    {isActive && (
                      <ChevronRight className="h-3 w-3 ml-auto relative z-10 text-[#B8860B] hidden md:block" />
                    )}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* ── Content Area ── */}
          <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ scrollbarGutter: 'stable' }}>
            <AnimatePresence mode="wait">
              {activeTab === "general" && <AppearanceSection key="general" />}
              {activeTab === "ai" && <AISection key="ai" />}
              {activeTab === "data" && <DataSection key="data" />}
              {activeTab === "about" && (
                <AboutSection key="about" onOpenShortcuts={() => setShowShortcuts(true)} />
              )}
            </AnimatePresence>
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
