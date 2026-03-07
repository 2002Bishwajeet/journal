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
  Loader2
} from "lucide-react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { theme, setTheme } = useThemePreference();
  const { isExporting, isImporting, handleExport, handleImport } = useSettingsModal();

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
          <TabsList className="flex flex-row md:flex-col h-auto w-full md:w-48 justify-start items-start bg-muted/30 border-b md:border-b-0 md:border-r rounded-none p-4 gap-2 overflow-x-auto md:overflow-y-auto">
            <TabsTrigger 
              value="general" 
              className="w-full justify-start data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-2.5 rounded-md"
            >
              <Monitor className="h-4 w-4 mr-2" />
              General
            </TabsTrigger>
            <TabsTrigger 
              value="data" 
              className="w-full justify-start data-[state=active]:bg-background data-[state=active]:shadow-sm px-3 py-2.5 rounded-md"
            >
              <Database className="h-4 w-4 mr-2" />
              Data & Security
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

              <div className="space-y-4">
                <h3 className="text-lg font-medium leading-none">Features</h3>
                <div className="flex items-center justify-between p-4 border rounded-xl bg-card">
                  <div className="space-y-1">
                    <Label htmlFor="ai-features" className="text-base">
                      AI Assistant
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Enable local WebLLM autocomplete and grammar features
                    </p>
                  </div>
                  <Switch id="ai-features" defaultChecked />
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
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
