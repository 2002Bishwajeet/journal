import { useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useQuickCaptureShortcut } from "@/hooks/useQuickCaptureShortcut";
import { nativePlatform } from "@/lib/native";
import {
  DEFAULT_CAPTURE_SHORTCUT,
  acceleratorFromEvent,
  displayShortcut,
} from "@/lib/quickCapture";
import { SectionHeader } from "./SectionHeader";

/** Desktop app: the global hotkey that opens the quick-capture window (#1014). */
export function QuickCaptureShortcutRow() {
  const { state, pickable, setShortcut } = useQuickCaptureShortcut();
  const [recording, setRecording] = useState(false);
  if (!state || !pickable) return null;

  const mac = nativePlatform() === "macos";

  const apply = (accelerator: string) =>
    setShortcut(accelerator).catch((err: unknown) => {
      console.error("[QuickCaptureShortcutRow]", err);
      toast.error(
        typeof err === "string" ? err : "Couldn't use that shortcut",
      );
    });

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    e.preventDefault();
    if (e.key === "Escape") {
      setRecording(false);
      return;
    }
    const accelerator = acceleratorFromEvent(e.nativeEvent, mac);
    if (!accelerator) return;
    setRecording(false);
    void apply(accelerator);
  };

  return (
    <div className="space-y-4">
      <SectionHeader subtitle="Press it anywhere, even when Journal is hidden, to jot a note down. The first line is the title.">
        Quick capture
      </SectionHeader>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="h-11 min-w-48 md:h-9"
          onClick={() => setRecording(true)}
          onKeyDown={onKeyDown}
          onBlur={() => setRecording(false)}
        >
          {recording
            ? "Press the new shortcut"
            : displayShortcut(state.shortcut, mac)}
        </Button>
        {state.shortcut !== DEFAULT_CAPTURE_SHORTCUT && (
          <Button
            variant="outline"
            className="h-11 md:h-9"
            onClick={() => void apply(DEFAULT_CAPTURE_SHORTCUT)}
          >
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
