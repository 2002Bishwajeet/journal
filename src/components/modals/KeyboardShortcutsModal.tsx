import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutEntry[];
}

const isMac = (navigator.userAgentData?.platform ?? navigator.platform)?.includes("mac") ||
  (navigator.userAgentData?.platform ?? navigator.platform)?.includes("Mac");
const mod = isMac ? "⌘" : "Ctrl";
const shift = isMac ? "⇧" : "Shift";

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "General",
    shortcuts: [
      { keys: [mod, "K"], description: "Search notes" },
      { keys: [mod, "N"], description: "New note" },
      { keys: [mod, "S"], description: "Save note" },
      { keys: [mod, "/"], description: "Keyboard shortcuts" },
      { keys: [mod, shift, "F"], description: "Focus mode" },
    ],
  },
  {
    title: "Text Formatting",
    shortcuts: [
      { keys: [mod, "B"], description: "Bold" },
      { keys: [mod, "I"], description: "Italic" },
      { keys: [mod, "U"], description: "Underline" },
      { keys: [mod, shift, "X"], description: "Strikethrough" },
      { keys: [mod, "E"], description: "Inline code" },
      { keys: [mod, ","], description: "Subscript" },
      { keys: [mod, "."], description: "Superscript" },
      { keys: [mod, "\\"], description: "Clear formatting" },
    ],
  },
  {
    title: "Blocks & Lists",
    shortcuts: [
      { keys: [mod, shift, "7"], description: "Ordered list" },
      { keys: [mod, shift, "8"], description: "Bullet list" },
      { keys: [mod, shift, "9"], description: "Task list" },
      { keys: [mod, shift, "K"], description: "Add link" },
      { keys: [mod, shift, "D"], description: "Duplicate block" },
      { keys: ["Tab"], description: "Indent" },
      { keys: [shift, "Tab"], description: "Outdent" },
      { keys: ["/"], description: "Slash commands" },
    ],
  },
  {
    title: "Text Alignment",
    shortcuts: [
      { keys: [mod, shift, "L"], description: "Align left" },
      { keys: [mod, shift, "E"], description: "Align center" },
      { keys: [mod, shift, "R"], description: "Align right" },
      { keys: [mod, shift, "J"], description: "Justify" },
    ],
  },
  {
    title: "History",
    shortcuts: [
      { keys: [mod, "Z"], description: "Undo" },
      { keys: [mod, shift, "Z"], description: "Redo" },
    ],
  },
  {
    title: "AI Features",
    shortcuts: [
      { keys: ["Tab"], description: "Accept autocomplete" },
      { keys: ["Escape"], description: "Dismiss suggestion" },
    ],
  },
];

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function KeyboardShortcutsModal({
  isOpen,
  onClose,
}: KeyboardShortcutsModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-2">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-semibold text-foreground mb-2">
                {group.title}
              </h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between gap-4"
                  >
                    <span className="text-sm text-muted-foreground">
                      {shortcut.description}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {shortcut.keys.map((key, i) => (
                        <span key={i} className="flex items-center gap-0.5">
                          {i > 0 && (
                            <span className="text-[10px] text-muted-foreground/50 mx-0.5">
                              +
                            </span>
                          )}
                          <Kbd>{key}</Kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 pt-3 border-t text-center">
          <p className="text-xs text-muted-foreground">
            Press{" "}
            <Kbd>{mod}</Kbd>{" "}
            <span className="text-[10px] text-muted-foreground/50 mx-0.5">+</span>{" "}
            <Kbd>/</Kbd>{" "}
            anytime to open this guide
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
