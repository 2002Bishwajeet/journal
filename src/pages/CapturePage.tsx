import { useQuickCapture } from "@/hooks/useQuickCapture";
import { nativePlatform } from "@/lib/native";

/** The desktop app's quick-capture window (#1014). Also works in a browser tab. */
export default function CapturePage() {
  const { text, setText, saving, canEdit, input, onKeyDown } = useQuickCapture();
  const saveKey = nativePlatform() === "macos" ? "Cmd" : "Ctrl";

  return (
    <div className="h-dvh bg-background p-3">
      <textarea
        ref={input}
        autoFocus
        aria-label="Quick note"
        value={text}
        disabled={saving}
        // Read-only (#1176): the field says why, and Esc still hides the window.
        readOnly={!canEdit}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={
          canEdit
            ? `Jot something down. The first line is the title. ${saveKey}+Enter saves, Esc hides.`
            : "Your notes are read-only on this device. Esc hides."
        }
        className="h-full w-full resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
