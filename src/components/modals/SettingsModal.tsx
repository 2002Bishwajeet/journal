import { useThemePreference } from "@/hooks/useThemePreference";
import { useSettingsModal } from "@/hooks/useSettingsModal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "lucide-react";
import { useAISettings } from "@/hooks/useAISettings";
import { useWebLLM } from "@/hooks/useWebLLM";
import { AVAILABLE_MODELS, getModelInfo } from "@/lib/webllm";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { theme, setTheme } = useThemePreference();
  const { isExporting, isImporting, handleExport, handleImport } = useSettingsModal();
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
      <DialogContent className="sm:max-w-4xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b bg-muted/10">
          <DialogTitle className="text-xl">Settings</DialogTitle>
          <DialogDescription>
            Manage your application preferences and data.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full h-[600px] sm:max-h-[80vh] flex flex-col md:flex-row">
          {/* Navigation Rail (Sidebar) */}
          <TabsList className="flex flex-row md:flex-col h-auto w-full md:w-52 justify-start items-start bg-muted/30 border-b md:border-b-0 md:border-r rounded-none p-3 md:p-4 gap-1 md:gap-1.5 overflow-x-auto md:overflow-y-auto shrink-0">
            <TabsTrigger
              value="general"
              className="w-full justify-start data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-2.5 rounded-md"
            >
              <Monitor className="h-4 w-4 mr-2" />
              General
            </TabsTrigger>
            <TabsTrigger
              value="ai"
              className="w-full justify-start data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-2.5 rounded-md"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              AI & Models
            </TabsTrigger>
            <TabsTrigger
              value="data"
              className="w-full justify-start data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-2.5 rounded-md"
            >
              <Database className="h-4 w-4 mr-2" />
              Data & Security
            </TabsTrigger>
            <TabsTrigger
              value="about"
              className="w-full justify-start data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-2.5 rounded-md"
            >
              <Info className="h-4 w-4 mr-2" />
              About
            </TabsTrigger>
          </TabsList>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
            <TabsContent value="general" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-4">
                <h3 className="text-lg font-medium leading-none">Appearance</h3>
                <div className="flex items-center justify-between p-4 border rounded-xl bg-card">
                  <div className="space-y-1">
                    <Label className="text-base">Theme</Label>
                    <p className="text-sm text-muted-foreground">
                      Select your preferred interface theme
                    </p>
                  </div>
                  <div className="flex items-center bg-muted p-1 rounded-lg">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 px-3 rounded-md transition-all",
                        theme === "light" &&
                          "bg-background shadow-sm text-foreground hover:bg-background"
                      )}
                      onClick={() => setTheme("light")}
                    >
                      <Sun className="h-4 w-4" />
                      <span className="sr-only">Light</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 px-3 rounded-md transition-all",
                        theme === "dark" &&
                          "bg-background shadow-sm text-foreground hover:bg-background"
                      )}
                      onClick={() => setTheme("dark")}
                    >
                      <Moon className="h-4 w-4" />
                      <span className="sr-only">Dark</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-8 px-3 rounded-md transition-all",
                        theme === "system" &&
                          "bg-background shadow-sm text-foreground hover:bg-background"
                      )}
                      onClick={() => setTheme("system")}
                    >
                      <Monitor className="h-4 w-4" />
                      <span className="sr-only">System</span>
                    </Button>
                  </div>
                </div>
              </div>

            </TabsContent>

            <TabsContent value="data" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-4">
                <h3 className="text-lg font-medium leading-none">Storage Location</h3>
                <div className="rounded-xl border p-5 space-y-3 bg-card">
                  <div className="flex items-center gap-2 text-primary">
                    <Database className="h-5 w-5" />
                    <span className="font-semibold">Target Drive</span>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Your notes are securely stored in a dedicated Homebase Drive (ID:
                    <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-xs">f4b63...</code>).
                    This ensures true ownership of your data.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium leading-none">Data Portability</h3>
                <div className="rounded-xl border p-5 space-y-5 bg-card">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-primary">
                      <Download className="h-5 w-5" />
                      <span className="font-semibold">Import & Export</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Manage your data outside the app. Import from Markdown/Zip archives or export
                      everything to your local filesystem.
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <input
                        type="file"
                        id="import-file"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        accept=".md,.zip,.csv"
                        multiple
                        onChange={(e) => {
                          if (e.target.files && e.target.files.length > 0) {
                            handleImport(e.target.files);
                            // Reset input
                            e.target.value = "";
                          }
                        }}
                        disabled={isImporting}
                      />
                      <Button
                        variant="secondary"
                        className="w-full justify-start h-10"
                        disabled={isImporting}
                      >
                        {isImporting ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Importing...
                          </>
                        ) : (
                          <>
                            <FolderInput className="h-4 w-4 mr-2" />
                            Import Data Archive
                          </>
                        )}
                      </Button>
                    </div>

                    <Button
                      variant="outline"
                      className="flex-1 justify-start h-10"
                      onClick={handleExport}
                      disabled={isExporting}
                    >
                      {isExporting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Exporting...
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Export All Notes
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium leading-none">Security</h3>
                <div className="rounded-xl border border-green-200 dark:border-green-900 p-5 space-y-2 bg-green-50/50 dark:bg-green-950/20">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-500">
                    <Shield className="h-5 w-5" />
                    <span className="font-semibold">End-to-End Encrypted</span>
                  </div>
                  <p className="text-sm text-green-800/80 dark:text-green-400/80">
                    All synchronization traffic is fully encrypted. Only you hold the cryptographic keys 
                    to decrypt your journal entries.
                  </p>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="ai" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {/* AI Status Banner */}
              <div className={cn(
                "rounded-xl border p-4 flex items-center gap-3",
                isAIReady
                  ? "border-green-200 dark:border-green-900 bg-green-50/50 dark:bg-green-950/20"
                  : isAILoading
                    ? "border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20"
                    : "border-muted bg-muted/20"
              )}>
                {isAIReady ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500 shrink-0" />
                ) : isAILoading ? (
                  <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-500 animate-spin shrink-0" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-muted-foreground shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {isAIReady
                      ? `Model loaded: ${getModelInfo(settings.modelId)?.name || settings.modelId}`
                      : isAILoading
                        ? loadingMessage || 'Loading model...'
                        : 'AI model not loaded'}
                  </p>
                  {isAILoading && (
                    <div className="mt-2 w-full bg-muted rounded-full h-1.5">
                      <div
                        className="bg-primary h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${Math.round(loadingProgress * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Master Toggle */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium leading-none">AI Assistant</h3>
                <div className="flex items-center justify-between p-4 border rounded-xl bg-card">
                  <div className="space-y-1">
                    <Label htmlFor="ai-enabled" className="text-base">Enable AI</Label>
                    <p className="text-sm text-muted-foreground">
                      Run a local LLM for autocomplete, grammar, and chat
                    </p>
                  </div>
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
                </div>
              </div>

              {/* Model Selection - only when enabled */}
              {settings.enabled && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium leading-none">Model</h3>
                  <div className="space-y-3">
                    {AVAILABLE_MODELS.map((model) => (
                      <div
                        key={model.id}
                        className={cn(
                          "flex items-start gap-3 p-4 border rounded-xl cursor-pointer transition-colors",
                          settings.modelId === model.id
                            ? "border-primary bg-primary/5"
                            : "bg-card hover:bg-muted/50"
                        )}
                        onClick={async () => {
                          if (model.id !== settings.modelId) {
                            updateSettings({ modelId: model.id });
                            if (isAIReady) {
                              await switchModel(model.id);
                            }
                          }
                        }}
                      >
                        <div className="mt-0.5">
                          <Cpu className={cn(
                            "h-5 w-5",
                            settings.modelId === model.id ? "text-primary" : "text-muted-foreground"
                          )} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{model.name}</span>
                            <span className="text-xs text-muted-foreground">{model.parameterCount}</span>
                            {model.recommended && (
                              <span className="text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                                Recommended
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{model.description}</p>
                          <div className="flex gap-3 mt-2 text-[11px] text-muted-foreground">
                            <span>Download: {model.downloadSize}</span>
                            <span>RAM: {model.memoryUsage}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Feature Toggles */}
              {settings.enabled && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium leading-none">Features</h3>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-4 border rounded-xl bg-card">
                      <div className="space-y-1">
                        <Label htmlFor="autocomplete-toggle" className="text-base">Autocomplete</Label>
                        <p className="text-sm text-muted-foreground">Ghost text suggestions while typing</p>
                      </div>
                      <Switch
                        id="autocomplete-toggle"
                        checked={settings.autocompleteEnabled}
                        onCheckedChange={(checked) => updateSettings({ autocompleteEnabled: checked })}
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 border rounded-xl bg-card">
                      <div className="space-y-1">
                        <Label htmlFor="grammar-toggle" className="text-base">Grammar Check</Label>
                        <p className="text-sm text-muted-foreground">Highlight grammar and spelling errors</p>
                      </div>
                      <Switch
                        id="grammar-toggle"
                        checked={settings.grammarEnabled}
                        onCheckedChange={(checked) => updateSettings({ grammarEnabled: checked })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Cache Management */}
              {settings.enabled && (
                <div className="space-y-4">
                  <h3 className="text-lg font-medium leading-none">Storage</h3>
                  <div className="rounded-xl border p-4 bg-card space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Model weights are cached locally in your browser storage (OPFS).
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={async () => {
                        if (confirm('This will delete cached model weights. You will need to re-download them next time.')) {
                          try {
                            const cacheNames = await caches.keys();
                            for (const name of cacheNames) {
                              if (name.includes('webllm') || name.includes('mlc')) {
                                await caches.delete(name);
                              }
                            }
                            const root = await navigator.storage.getDirectory();
                            for await (const [name] of (root as any).entries()) {
                              if (name.includes('mlc') || name.includes('webllm')) {
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
                </div>
              )}
            </TabsContent>

            <TabsContent value="about" className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="space-y-4">
                <h3 className="text-lg font-medium leading-none">Journal</h3>
                <div className="rounded-xl border p-5 bg-card space-y-3">
                  <p className="text-2xl font-bold">Journal</p>
                  <p className="text-sm text-muted-foreground">
                    A local-first, end-to-end encrypted personal journal with on-device AI.
                  </p>
                  <p className="text-xs text-muted-foreground">Version 1.0.6</p>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium leading-none">Privacy</h3>
                <div className="rounded-xl border border-green-200 dark:border-green-900 p-5 bg-green-50/50 dark:bg-green-950/20 space-y-2">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-500">
                    <Shield className="h-5 w-5" />
                    <span className="font-semibold">Your Data, Your Device</span>
                  </div>
                  <ul className="text-sm text-green-800/80 dark:text-green-400/80 space-y-1 list-disc list-inside">
                    <li>All notes stored locally in your browser</li>
                    <li>AI runs entirely on-device via WebLLM</li>
                    <li>Sync traffic is end-to-end encrypted</li>
                    <li>No data sent to external servers (except optional web search)</li>
                  </ul>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
