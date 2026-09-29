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
import { useAIPreferences } from "@/hooks/useAIPreferences";
import { getModelInfo } from "@/lib/webllm";
import { SectionHeader } from "../SectionHeader";
import { SettingsRow } from "../SettingsRow";
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
    <div className="space-y-10">
      {/* AI Status Banner */}
      <div className="rounded-xl border bg-muted/40 p-5">
        <div className="flex items-center gap-4">
          <div className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-muted">
            {isAIReady ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            ) : isAILoading ? (
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
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
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200"
                  style={{ width: `${Math.round(loadingProgress * 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Master Toggle */}
      <div className="space-y-6">
        <SectionHeader subtitle="On-device intelligence for your writing">
          AI Assistant
        </SectionHeader>
        <div className="rounded-lg border">
          <SettingsRow
            id="ai-enabled"
            icon={Sparkles}
            label="Enable AI"
            description="Run a local LLM for autocomplete, grammar, and chat"
            control={
              <Switch
                checked={settings.enabled}
                onCheckedChange={(checked) => setEnabled(checked)}
              />
            }
          />
        </div>
      </div>

      {/* Model Selection */}
      {settings.enabled && (
        <div className="space-y-6">
          <SectionHeader subtitle="Choose a model based on your device capabilities">
            Model
          </SectionHeader>
          <AIModelList selectedModelId={settings.modelId} onSelect={selectModel} />
        </div>
      )}

      {/* Feature Toggles */}
      {settings.enabled && (
        <div className="space-y-6">
          <SectionHeader subtitle="Fine-tune which AI capabilities are active">
            Features
          </SectionHeader>
          <div className="rounded-lg border">
            <SettingsRow
              id="autocomplete-toggle"
              icon={Zap}
              label="Autocomplete"
              description="Ghost text suggestions while typing"
              control={
                <Switch
                  checked={settings.autocompleteEnabled}
                  onCheckedChange={(checked) => setAutocomplete(checked)}
                />
              }
            />
            <SettingsRow
              id="grammar-toggle"
              icon={SpellCheck}
              label="Grammar Check"
              description="Highlight grammar and spelling errors"
              control={
                <Switch
                  checked={settings.grammarEnabled}
                  onCheckedChange={(checked) => setGrammar(checked)}
                />
              }
            />
          </div>
        </div>
      )}

      {/* Cache Management */}
      {settings.enabled && (
        <div className="space-y-6">
          <SectionHeader subtitle="Manage cached model weights on your device">
            Storage
          </SectionHeader>
          <div className="rounded-xl border border-border/60 p-5 bg-card space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Model weights are cached locally in your browser storage (OPFS)
              for faster load times.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-11 md:h-8 text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/20"
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
        </div>
      )}
    </div>
  );
}
