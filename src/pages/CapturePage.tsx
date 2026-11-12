import { useQuickCapture } from "@/hooks/useQuickCapture";
import { nativePlatform } from "@/lib/native";

/** The desktop app's quick-capture window (#1014). Also works in a browser tab. */
export default function CapturePage() {
  const { text, setText, saving, input, onKeyDown } = useQuickCapture();
  const saveKey = nativePlatform() === "macos" ? "Cmd" : "Ctrl";

  return (
    <div className="h-dvh bg-background p-3">
      <textarea
        ref={input}
        autoFocus
        aria-label="Quick note"
        value={text}
        disabled={saving}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={`Jot something down. The first line is the title. ${saveKey}+Enter saves, Esc hides.`}
        className="h-full w-full resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
