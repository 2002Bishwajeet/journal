import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Sparkles,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Zap,
  SpellCheck,
} from "lucide-react";
import { motion } from "framer-motion";
import { useAIPreferences } from "@/hooks/useAIPreferences";
import { getModelInfo } from "@/lib/webllm";
import { SectionHeader } from "../SectionHeader";
import { SettingsRow } from "../SettingsRow";
import { contentVariants, staggerContainer, staggerItem } from "../motion";
import AIModelList from "./AIModelList";

export default function AISection() {
  const {
    settings,
    isReady: isAIReady,
    isLoading: isAILoading,
    loadingProgress,
    loadingMessage,
    setEnabled,
    selectModel,
    setAutocomplete,
    setGrammar,
    clearCache,
  } = useAIPreferences();

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
                onCheckedChange={(checked) => setEnabled(checked)}
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
          <AIModelList selectedModelId={settings.modelId} onSelect={selectModel} />
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
                  onCheckedChange={(checked) => setAutocomplete(checked)}
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
                  onCheckedChange={(checked) => setGrammar(checked)}
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
                    await clearCache();
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
