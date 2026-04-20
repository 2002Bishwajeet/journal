import { useState, type ReactNode } from "react";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useSettingsModal } from "@/hooks/useSettingsModal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Moon,
  Sun,
  Monitor,
  Database,
  Shield,
  Download,
  FolderInput,
  Loader2,
  Sparkles,
  Cpu,
  Info,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Lock,
  HardDrive,
  Zap,
  SpellCheck,
  Keyboard,
} from "lucide-react";
import logo from "@/assets/logo_withoutbg.png";
import { motion, AnimatePresence } from "framer-motion";
import { useAISettings } from "@/hooks/useAISettings";
import KeyboardShortcutsModal from "./KeyboardShortcutsModal";
import { useWebLLM } from "@/hooks/useWebLLM";
import { AVAILABLE_MODELS, getModelInfo } from "@/lib/webllm";

interface SettingsModalProps {
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

const contentVariants = {
  hidden: { opacity: 0, y: 8, filter: "blur(4px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: {
    opacity: 0,
    y: -6,
    filter: "blur(4px)",
    transition: { duration: 0.2 },
  },
};

const staggerContainer = {
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { theme, setTheme } = useThemePreference();
  const { isExporting, isImporting, handleExport, handleImport } =
    useSettingsModal();
  const { settings, updateSettings } = useAISettings();
  const {
    isReady: isAIReady,
    isLoading: isAILoading,
    loadingProgress,
    loadingMessage,
    initialize: initializeAI,
    switchModel,
  } = useWebLLM();

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
          <div className="flex-1 overflow-y-auto">
            <AnimatePresence mode="wait">
              {activeTab === "general" && (
                <GeneralTab key="general" theme={theme} setTheme={setTheme} />
              )}
              {activeTab === "ai" && (
                <AITab
                  key="ai"
                  settings={settings}
                  updateSettings={updateSettings}
                  isAIReady={isAIReady}
                  isAILoading={isAILoading}
                  loadingProgress={loadingProgress}
                  loadingMessage={loadingMessage}
                  initializeAI={initializeAI}
                  switchModel={switchModel}
                />
              )}
              {activeTab === "data" && (
                <DataTab
                  key="data"
                  isExporting={isExporting}
                  isImporting={isImporting}
                  handleExport={handleExport}
                  handleImport={handleImport}
                />
              )}
              {activeTab === "about" && <AboutTab key="about" onOpenShortcuts={() => setShowShortcuts(true)} />}
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

/* ═══════════════════════════════════════
   Section Header
   ═══════════════════════════════════════ */

function SectionHeader({
  children,
  subtitle,
}: {
  children: ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="space-y-1">
      <h3
        className="text-xl tracking-tight text-foreground"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        {children}
      </h3>
      {subtitle && (
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   General Tab
   ═══════════════════════════════════════ */

function GeneralTab({
  theme,
  setTheme,
}: {
  theme: string;
  setTheme: (t: string) => void;
}) {
  const themes = [
    {
      id: "light",
      label: "Light",
      icon: Sun,
      bg: "#FDFCF8",
      fg: "#2C2B29",
      line: "#E6E4DD",
      accent: "#F2F0E9",
    },
    {
      id: "dark",
      label: "Dark",
      icon: Moon,
      bg: "#1C1B1A",
      fg: "#E6E4DD",
      line: "#3E3D3A",
      accent: "#2C2B29",
    },
    {
      id: "system",
      label: "System",
      icon: Monitor,
      bg: "linear-gradient(135deg, #FDFCF8 50%, #1C1B1A 50%)",
      fg: "#8A8780",
      line: "#E6E4DD",
      accent: "#F2F0E9",
    },
  ];

  return (
    <motion.div
      variants={contentVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="p-8 space-y-10"
    >
      <SectionHeader subtitle="Choose how your journal looks and feels">
        Appearance
      </SectionHeader>

      {/* Theme Previews */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-3 gap-4"
      >
        {themes.map((t) => {
          const Icon = t.icon;
          const isActive = theme === t.id;
          return (
            <motion.button
              key={t.id}
              variants={staggerItem}
              onClick={() => setTheme(t.id)}
              className={cn(
                "relative group rounded-xl overflow-hidden transition-all duration-300 text-left",
                isActive
                  ? "ring-2 ring-[#B8860B] ring-offset-2 ring-offset-background"
                  : "ring-1 ring-border hover:ring-border/80 hover:shadow-md"
              )}
            >
              {/* Mini page preview */}
              <div
                className="h-28 p-3 flex flex-col gap-1.5"
                style={{
                  background: t.id === "system" ? t.bg : t.bg,
                  ...(t.id === "system" ? {} : {}),
                }}
              >
                {/* Fake sidebar + content area */}
                <div className="flex gap-2 flex-1">
                  <div
                    className="w-6 rounded-sm flex flex-col gap-1 p-1"
                    style={{ background: t.accent }}
                  >
                    <div
                      className="h-1 w-full rounded-full"
                      style={{ background: t.line }}
                    />
                    <div
                      className="h-1 w-3/4 rounded-full"
                      style={{ background: t.line }}
                    />
                    <div
                      className="h-1 w-full rounded-full"
                      style={{ background: t.line }}
                    />
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <div
                      className="h-2 w-3/4 rounded-full"
                      style={{ background: t.fg, opacity: 0.2 }}
                    />
                    <div
                      className="h-1 w-full rounded-full"
                      style={{ background: t.fg, opacity: 0.08 }}
                    />
                    <div
                      className="h-1 w-5/6 rounded-full"
                      style={{ background: t.fg, opacity: 0.08 }}
                    />
                    <div
                      className="h-1 w-2/3 rounded-full"
                      style={{ background: t.fg, opacity: 0.08 }}
                    />
                  </div>
                </div>
              </div>

              {/* Label area */}
              <div
                className={cn(
                  "px-3 py-2.5 flex items-center gap-2 border-t transition-colors",
                  isActive
                    ? "bg-[#B8860B]/5 border-[#B8860B]/20"
                    : "bg-card border-border/60"
                )}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5",
                    isActive ? "text-[#B8860B]" : "text-muted-foreground"
                  )}
                />
                <span
                  className={cn(
                    "text-xs font-medium",
                    isActive ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {t.label}
                </span>
                {isActive && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="ml-auto"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#B8860B]" />
                  </motion.div>
                )}
              </div>
            </motion.button>
          );
        })}
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════
   AI & Models Tab
   ═══════════════════════════════════════ */

interface AITabProps {
  settings: ReturnType<typeof useAISettings>["settings"];
  updateSettings: ReturnType<typeof useAISettings>["updateSettings"];
  isAIReady: boolean;
  isAILoading: boolean;
  loadingProgress: number;
  loadingMessage: string;
  initializeAI: () => Promise<boolean>;
  switchModel: (id: string) => Promise<boolean>;
}

function AITab({
  settings,
  updateSettings,
  isAIReady,
  isAILoading,
  loadingProgress,
  loadingMessage,
  initializeAI,
  switchModel,
}: AITabProps) {
  return (
    <motion.div
      variants={contentVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="p-8 space-y-10"
    >
      {/* AI Status Banner */}
      <motion.div
        variants={staggerItem}
        initial="hidden"
        animate="visible"
        className={cn(
          "relative rounded-xl p-5 overflow-hidden",
          isAIReady
            ? "bg-emerald-50/60 dark:bg-emerald-950/20"
            : isAILoading
              ? "bg-amber-50/60 dark:bg-amber-950/20"
              : "bg-muted/30"
        )}
        style={{
          border: isAIReady
            ? "1px solid rgba(16, 185, 129, 0.2)"
            : isAILoading
              ? "1px solid rgba(184, 134, 11, 0.2)"
              : "1px solid var(--border)",
        }}
      >
        {/* Decorative glow */}
        {(isAIReady || isAILoading) && (
          <div
            className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-20 pointer-events-none"
            style={{
              background: isAIReady ? "#10B981" : "#B8860B",
            }}
          />
        )}
        <div className="relative flex items-center gap-4">
          <div
            className={cn(
              "shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
              isAIReady
                ? "bg-emerald-100 dark:bg-emerald-900/40"
                : isAILoading
                  ? "bg-amber-100 dark:bg-amber-900/40"
                  : "bg-muted"
            )}
          >
            {isAIReady ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            ) : isAILoading ? (
              <Loader2 className="h-5 w-5 text-[#B8860B] animate-spin" />
            ) : (
              <AlertCircle className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              {isAIReady
                ? `Model Active — ${getModelInfo(settings.modelId)?.name || settings.modelId}`
                : isAILoading
                  ? loadingMessage || "Loading model..."
                  : "AI model not loaded"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isAIReady
                ? "Running entirely on your device"
                : isAILoading
                  ? `${Math.round(loadingProgress * 100)}% complete`
                  : "Enable AI to get started"}
            </p>
            {isAILoading && (
              <div className="mt-3 w-full bg-border/50 rounded-full h-1.5 overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "#B8860B" }}
                  initial={{ width: 0 }}
                  animate={{
                    width: `${Math.round(loadingProgress * 100)}%`,
                  }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Master Toggle */}
      <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-6">
        <SectionHeader subtitle="On-device intelligence for your writing">
          AI Assistant
        </SectionHeader>
        <motion.div variants={staggerItem}>
          <SettingsRow
            icon={Sparkles}
            label="Enable AI"
            description="Run a local LLM for autocomplete, grammar, and chat"
            trailing={
              <Switch
                id="ai-enabled"
                checked={settings.enabled}
                onCheckedChange={(checked) => {
                  updateSettings({ enabled: checked });
                  if (checked && !isAIReady && !isAILoading) {
                    initializeAI();
                  }
                }}
              />
            }
          />
        </motion.div>
      </motion.div>

      {/* Model Selection */}
      {settings.enabled && (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          <SectionHeader subtitle="Choose a model based on your device capabilities">
            Model
          </SectionHeader>
          <div className="space-y-2.5">
            {AVAILABLE_MODELS.map((model, i) => (
              <motion.button
                key={model.id}
                variants={staggerItem}
                custom={i}
                onClick={async () => {
                  if (model.id !== settings.modelId) {
                    updateSettings({ modelId: model.id });
                    if (isAIReady) {
                      await switchModel(model.id);
                    }
                  }
                }}
                className={cn(
                  "w-full text-left p-4 rounded-xl border transition-all duration-200 group",
                  settings.modelId === model.id
                    ? "border-[#B8860B]/30 bg-[#B8860B]/[0.04]"
                    : "border-border/60 bg-card hover:border-border hover:shadow-sm"
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                      settings.modelId === model.id
                        ? "bg-[#B8860B]/10"
                        : "bg-muted/60 group-hover:bg-muted"
                    )}
                  >
                    <Cpu
                      className={cn(
                        "h-4 w-4",
                        settings.modelId === model.id
                          ? "text-[#B8860B]"
                          : "text-muted-foreground"
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">
                        {model.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded-md font-mono">
                        {model.parameterCount}
                      </span>
                      {model.recommended && (
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{
                            background: "rgba(184, 134, 11, 0.1)",
                            color: "#B8860B",
                          }}
                        >
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {model.description}
                    </p>
                    {/* Resource indicators */}
                    <div className="flex items-center gap-4 mt-2.5">
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Download className="h-3 w-3" />
                        {model.downloadSize}
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <HardDrive className="h-3 w-3" />
                        {model.memoryUsage}
                      </div>
                    </div>
                  </div>
                  {settings.modelId === model.id && (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
                      <CheckCircle2 className="h-5 w-5 text-[#B8860B] shrink-0 mt-1" />
                    </motion.div>
                  )}
                </div>
              </motion.button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Feature Toggles */}
      {settings.enabled && (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          <SectionHeader subtitle="Fine-tune which AI capabilities are active">
            Features
          </SectionHeader>
          <motion.div variants={staggerItem}>
            <SettingsRow
              icon={Zap}
              label="Autocomplete"
              description="Ghost text suggestions while typing"
              trailing={
                <Switch
                  id="autocomplete-toggle"
                  checked={settings.autocompleteEnabled}
                  onCheckedChange={(checked) =>
                    updateSettings({ autocompleteEnabled: checked })
                  }
                />
              }
            />
          </motion.div>
          <motion.div variants={staggerItem}>
            <SettingsRow
              icon={SpellCheck}
              label="Grammar Check"
              description="Highlight grammar and spelling errors"
              trailing={
                <Switch
                  id="grammar-toggle"
                  checked={settings.grammarEnabled}
                  onCheckedChange={(checked) =>
                    updateSettings({ grammarEnabled: checked })
                  }
                />
              }
            />
          </motion.div>
        </motion.div>
      )}

      {/* Cache Management */}
      {settings.enabled && (
        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="space-y-6"
        >
          <SectionHeader subtitle="Manage cached model weights on your device">
            Storage
          </SectionHeader>
          <motion.div variants={staggerItem}>
            <div className="rounded-xl border border-border/60 p-5 bg-card space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Model weights are cached locally in your browser storage (OPFS)
                for faster load times.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/20"
                onClick={async () => {
                  if (
                    confirm(
                      "This will delete cached model weights. You will need to re-download them next time."
                    )
                  ) {
                    try {
                      const cacheNames = await caches.keys();
                      for (const name of cacheNames) {
                        if (
                          name.includes("webllm") ||
                          name.includes("mlc")
                        ) {
                          await caches.delete(name);
                        }
                      }
                      const root = await navigator.storage.getDirectory();
                      for await (const [name] of (root as FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
                        if (
                          name.includes("mlc") ||
                          name.includes("webllm")
                        ) {
                          await root.removeEntry(name, { recursive: true });
                        }
                      }
                    } catch {
                      // Ignore cleanup errors
                    }
                    window.location.reload();
                  }
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear Model Cache
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </motion.div>
  );
}

/* ═══════════════════════════════════════
   Data & Security Tab
   ═══════════════════════════════════════ */

interface DataTabProps {
  isExporting: boolean;
  isImporting: boolean;
  handleExport: () => void;
  handleImport: (files: FileList) => void;
}

function DataTab({
  isExporting,
  isImporting,
  handleExport,
  handleImport,
}: DataTabProps) {
  return (
    <motion.div
      variants={contentVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="p-8 space-y-10"
    >
      {/* Storage */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        <SectionHeader subtitle="Where your journal lives">
          Storage
        </SectionHeader>
        <motion.div variants={staggerItem}>
          <div className="rounded-xl border border-border/60 p-5 bg-card">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/5 flex items-center justify-center">
                <Database className="h-5 w-5 text-primary" />
              </div>
              <div>
                <span className="font-semibold text-sm">
                  Homebase Drive
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Dedicated encrypted drive ·{" "}
                  <code className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">
                    f4b63...
                  </code>
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Import / Export */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        <SectionHeader subtitle="Move data in and out of your journal">
          Data Portability
        </SectionHeader>
        <motion.div variants={staggerItem} className="flex flex-col sm:flex-row gap-3">
          {/* Import */}
          <div className="relative flex-1">
            <input
              type="file"
              id="import-file"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              accept=".md,.zip,.csv"
              multiple
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleImport(e.target.files);
                  e.target.value = "";
                }
              }}
              disabled={isImporting}
            />
            <div
              className={cn(
                "rounded-xl border border-dashed border-border p-5 text-center transition-colors hover:border-[#B8860B]/40 hover:bg-[#B8860B]/[0.02]",
                isImporting && "opacity-60 pointer-events-none"
              )}
            >
              {isImporting ? (
                <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
              ) : (
                <FolderInput className="h-6 w-6 mx-auto text-muted-foreground" />
              )}
              <p className="text-sm font-medium mt-2">
                {isImporting ? "Importing..." : "Import Archive"}
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                .md, .zip, or .csv
              </p>
            </div>
          </div>

          {/* Export */}
          <button
            className={cn(
              "flex-1 rounded-xl border border-dashed border-border p-5 text-center transition-colors hover:border-[#B8860B]/40 hover:bg-[#B8860B]/[0.02]",
              isExporting && "opacity-60 pointer-events-none"
            )}
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? (
              <Loader2 className="h-6 w-6 mx-auto animate-spin text-muted-foreground" />
            ) : (
              <Download className="h-6 w-6 mx-auto text-muted-foreground" />
            )}
            <p className="text-sm font-medium mt-2">
              {isExporting ? "Exporting..." : "Export All Notes"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Download your data
            </p>
          </button>
        </motion.div>
      </motion.div>

      {/* Security */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        <SectionHeader subtitle="How your data is protected">
          Security
        </SectionHeader>
        <motion.div variants={staggerItem}>
          <div
            className="rounded-xl p-5 space-y-4 relative overflow-hidden"
            style={{
              background:
                "linear-gradient(135deg, rgba(16, 185, 129, 0.04) 0%, rgba(16, 185, 129, 0.01) 100%)",
              border: "1px solid rgba(16, 185, 129, 0.15)",
            }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100/80 dark:bg-emerald-900/30 flex items-center justify-center">
                <Lock className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <span className="font-semibold text-sm text-emerald-700 dark:text-emerald-400">
                  End-to-End Encrypted
                </span>
                <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 mt-0.5">
                  Only you hold the keys
                </p>
              </div>
            </div>
            <div className="pl-[52px]">
              <ul className="text-sm text-emerald-800/70 dark:text-emerald-400/70 space-y-1.5">
                <li className="flex items-center gap-2">
                  <Shield className="h-3 w-3 shrink-0" />
                  All sync traffic is fully encrypted
                </li>
                <li className="flex items-center gap-2">
                  <Shield className="h-3 w-3 shrink-0" />
                  Cryptographic keys never leave your device
                </li>
              </ul>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════
   About Tab
   ═══════════════════════════════════════ */

function AboutTab({ onOpenShortcuts }: { onOpenShortcuts: () => void }) {
  return (
    <motion.div
      variants={contentVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      className="p-8 space-y-10"
    >
      {/* Brand */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        <motion.div variants={staggerItem} className="text-center py-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/5 mb-4">
            <img src={logo} alt="Journal" className="h-10 w-10 object-contain" />
          </div>
          <h2
            className="text-3xl tracking-tight"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Journal
          </h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs mx-auto leading-relaxed">
            A local-first, end-to-end encrypted personal journal with on-device
            AI.
          </p>
          <span
            className="inline-block mt-3 text-[11px] font-mono text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-md"
          >
            v1.0.6
          </span>
          <button
            onClick={onOpenShortcuts}
            className="flex items-center gap-2 mx-auto mt-4 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Keyboard className="h-4 w-4" />
            View keyboard shortcuts
          </button>
        </motion.div>
      </motion.div>

      {/* Decorative divider */}
      <div className="flex items-center gap-4 px-8">
        <div className="flex-1 h-px bg-border/60" />
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: "#B8860B" }}
        />
        <div className="flex-1 h-px bg-border/60" />
      </div>

      {/* Privacy */}
      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-6"
      >
        <SectionHeader subtitle="Built with privacy as a foundation">
          Privacy Promise
        </SectionHeader>
        <motion.div variants={staggerItem}>
          <div
            className="rounded-xl p-5 relative overflow-hidden"
            style={{
              background:
                "linear-gradient(135deg, rgba(16, 185, 129, 0.04) 0%, rgba(16, 185, 129, 0.01) 100%)",
              border: "1px solid rgba(16, 185, 129, 0.15)",
            }}
          >
            <ul className="space-y-3">
              {[
                {
                  icon: Database,
                  text: "All notes stored locally in your browser",
                },
                {
                  icon: Cpu,
                  text: "AI runs entirely on-device via WebLLM",
                },
                {
                  icon: Lock,
                  text: "Sync traffic is end-to-end encrypted",
                },
                {
                  icon: Shield,
                  text: "No data sent to external servers",
                },
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100/80 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                    <item.icon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <span className="text-sm text-emerald-800/80 dark:text-emerald-400/70">
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════
   Settings Row (reusable)
   ═══════════════════════════════════════ */

function SettingsRow({
  icon: Icon,
  label,
  description,
  trailing,
}: {
  icon: typeof Monitor;
  label: string;
  description: string;
  trailing: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between p-4 rounded-xl border border-border/60 bg-card hover:bg-accent/30 transition-colors">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-muted/60 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="space-y-0.5">
          <Label className="text-sm font-semibold">{label}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {trailing}
    </div>
  );
}
