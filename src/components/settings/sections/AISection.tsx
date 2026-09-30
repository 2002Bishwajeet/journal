import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Sparkles, Trash2, Zap, SpellCheck } from "lucide-react";
import ConfirmDialog from "@/components/modals/ConfirmDialog";
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
    error,
    isSupported,
    initialize,
    setEnabled,
    selectModel,
    setAutocomplete,
    setGrammar,
    clearCache,
  } = useAIPreferences();
  const [isConfirmingRemove, setIsConfirmingRemove] = useState(false);
  const percent = Math.round(loadingProgress * 100);

  const enableRow = (
    <div className="rounded-lg border">
      <SettingsRow
        id="ai-enabled"
        icon={Sparkles}
        label="Enable on-device AI"
        description="Runs a language model in this browser for autocomplete and grammar. Nothing you write leaves your device."
        control={
          <Switch
            checked={isSupported && settings.enabled}
            disabled={!isSupported}
            onCheckedChange={(checked) => setEnabled(checked)}
          />
        }
      />
    </div>
  );

  if (!isSupported) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          On-device AI needs a larger screen (768 px or wider) and isn't
          available on phones.
        </p>
        {enableRow}
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {/* Master Toggle + Status */}
      <div className="space-y-6">
        <SectionHeader subtitle="On-device intelligence for your writing">
          AI Assistant
        </SectionHeader>
        {enableRow}
        {settings.enabled && (
          <div role="status" aria-live="polite" className="text-sm">
            {isAILoading ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate">
                    {loadingMessage || "Loading model..."}
                  </p>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {percent}%
                  </span>
                </div>
                <div className="w-full bg-border/50 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            ) : error ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={() => initialize()}>
                  Retry
                </Button>
              </div>
            ) : isAIReady ? (
              <p className="text-muted-foreground">
                Ready · {getModelInfo(settings.modelId)?.name || settings.modelId} · running on this device
              </p>
            ) : null}
          </div>
        )}
      </div>

      {/* Model Selection */}
      {settings.enabled && (
        <div className="space-y-6">
          <SectionHeader subtitle="Choose a model based on your device capabilities">
            Model
          </SectionHeader>
          <AIModelList
            selectedModelId={settings.modelId}
            onSelect={selectModel}
            disabled={isAILoading}
          />
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
              description="Shows grey suggested text as you type. Press Tab to accept."
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
              description="Underlines likely grammar and spelling mistakes in the open note."
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

      {/* Model files */}
      <div className="space-y-6">
        <SectionHeader subtitle="Downloaded models are stored in this browser so they load faster next time.">
          Model files
        </SectionHeader>
        <Button
          variant="outline"
          size="sm"
          className="h-11 md:h-8 text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/20"
          onClick={() => setIsConfirmingRemove(true)}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Remove downloaded models
        </Button>
        <ConfirmDialog
          isOpen={isConfirmingRemove}
          onClose={() => setIsConfirmingRemove(false)}
          onConfirm={() => clearCache()}
          title="Remove downloaded models?"
          description="This frees up space in this browser. AI will be turned off and the model will download again the next time you turn it on."
          confirmText="Remove"
        />
      </div>
    </div>
  );
}
