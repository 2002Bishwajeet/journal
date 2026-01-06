import { useThemePreference } from "@/hooks/useThemePreference";
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
import { Moon, Sun, Monitor, Database, Shield } from "lucide-react";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { theme, setTheme } = useThemePreference();

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-106.25">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage your application preferences and data.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="data">Data & Security</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-6 py-4">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base">Theme</Label>
                  <p className="text-xs text-muted-foreground">
                    Select appearance
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

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="ai-features" className="text-base">
                    AI Assistant
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Enable local WebLLM features
                  </p>
                </div>
                <Switch id="ai-features" defaultChecked />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="data" className="space-y-4 py-4">
            <div className="space-y-4">
              <div className="rounded-md border p-4 space-y-2">
                <div className="flex items-center gap-2 text-primary">
                  <Database className="h-4 w-4" />
                  <span className="font-medium text-sm">Target Drive</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your notes are stored in a dedicated Homebase Drive (ID:
                  f4b63...).
                </p>
              </div>

              <div className="rounded-md border p-4 space-y-2 bg-muted/50">
                <div className="flex items-center gap-2 text-green-600">
                  <Shield className="h-4 w-4" />
                  <span className="font-medium text-sm">
                    End-to-End Encrypted
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  All sync traffic is encrypted. Only you have the keys to
                  decrypt your data.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
