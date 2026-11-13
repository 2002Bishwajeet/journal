import type { Ref } from "react";
import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  IndentDecrease,
  IndentIncrease,
  List,
  ListOrdered,
  ListTodo,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { shiftIndent } from "@/lib/editor/mobileBar";
import { safeEditorCommand, type ToolbarState } from "./shared";

interface MobileStylePanelProps {
  editor: Editor;
  state: ToolbarState;
  /** The keyboard's height; null when unknown, and the panel takes its content's height. */
  height: number | null;
  onClose: () => void;
  ref: Ref<HTMLDivElement>;
}

// Taps keep focus on the panel, so the keyboard stays down while styles change.
const keepFocus = (e: React.MouseEvent) => e.preventDefault();
const PRESS = "touch-manipulation select-none transition-colors active:bg-primary/20";
const ACTIVE = "bg-primary/15 text-primary";

/**
 * The Aa panel (#1272): stands in for the keyboard, like Apple Notes' Format panel. Each tap
 * styles the current block(s) without bringing the keyboard back; Close does.
 */
export function MobileStylePanel({ editor, state, height, onClose, ref }: MobileStylePanelProps) {
  // Applied without focus(): focusing the note would raise the keyboard over the panel.
  const run = (command: () => void) => safeEditorCommand(editor, command);
  const listItem = state.isTaskList ? "taskItem" : state.isBulletList || state.isOrderedList ? "listItem" : null;
  // In a list, indent nests the item; elsewhere it steps the block's indent.
  const indent = (delta: 1 | -1) => {
    if (listItem && delta > 0) editor.commands.sinkListItem(listItem);
    else if (listItem) editor.commands.liftListItem(listItem);
    else editor.commands.command(({ tr }) => shiftIndent(tr, delta));
  };

  const styles = [
    { label: "Title", text: "text-xl font-bold", active: state.isHeading1, apply: () => editor.commands.setHeading({ level: 1 }) },
    { label: "Heading", text: "text-lg font-bold", active: state.isHeading2, apply: () => editor.commands.setHeading({ level: 2 }) },
    { label: "Subheading", text: "text-base font-semibold", active: state.isHeading3, apply: () => editor.commands.setHeading({ level: 3 }) },
    { label: "Body", text: "text-base", active: state.isParagraph, apply: () => editor.commands.setParagraph() },
    { label: "Monospace", text: "font-mono text-sm", active: state.isCodeBlock, apply: () => editor.commands.setCodeBlock() },
    { label: "Quote", text: "text-base italic", active: state.isBlockquote, apply: () => editor.commands.toggleBlockquote() },
  ];
  const lists: IconItem[] = [
    { label: "Bullet List", icon: List, active: state.isBulletList, apply: () => editor.commands.toggleBulletList() },
    { label: "Numbered List", icon: ListOrdered, active: state.isOrderedList, apply: () => editor.commands.toggleOrderedList() },
    { label: "Task List", icon: ListTodo, active: state.isTaskList, apply: () => editor.commands.toggleTaskList() },
  ];
  const indents: IconItem[] = [
    { label: "Outdent", icon: IndentDecrease, apply: () => indent(-1) },
    { label: "Indent", icon: IndentIncrease, apply: () => indent(1) },
  ];
  const alignments: IconItem[] = (
    [
      ["left", "Align Left", AlignLeft],
      ["center", "Align Center", AlignCenter],
      ["right", "Align Right", AlignRight],
      ["justify", "Justify", AlignJustify],
    ] as const
  ).map(([value, label, icon]) => ({
    label,
    icon,
    active: state.textAlign === value,
    apply: () => editor.commands.setTextAlign(value),
  }));

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label="Format"
      data-style-panel
      className="pointer-events-auto fixed inset-x-0 bottom-0 flex max-h-[70dvh] flex-col rounded-t-2xl border-t border-border bg-card text-card-foreground shadow-[0_-8px_24px_rgb(0_0_0/0.08)] outline-none animate-in slide-in-from-bottom duration-(--duration-sheet) ease-(--ease-standard)"
      style={{
        height: height ?? undefined,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingLeft: "env(safe-area-inset-left, 0px)",
        paddingRight: "env(safe-area-inset-right, 0px)",
      }}
    >
      <div className="flex h-13 shrink-0 items-center justify-between pr-2 pl-5">
        <h2 className="text-base font-semibold">Format</h2>
        <button
          type="button"
          onMouseDown={keepFocus}
          onClick={onClose}
          title="Close"
          aria-label="Close format panel"
          className={cn(PRESS, "flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground")}
        >
          <X className="size-5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4">
        <div className="grid grid-cols-3 gap-2">
          {styles.map((style) => (
            <button
              key={style.label}
              type="button"
              onMouseDown={keepFocus}
              onClick={() => run(style.apply)}
              aria-pressed={style.active}
              className={cn(PRESS, "h-12 truncate rounded-xl bg-muted px-2", style.text, style.active && ACTIVE)}
            >
              {style.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <IconGroup label="Lists" items={lists} run={run} className="flex-3" />
          <IconGroup label="Indent" items={indents} run={run} className="flex-2" />
        </div>
        <IconGroup label="Alignment" items={alignments} run={run} />
      </div>
    </div>
  );
}

interface IconItem {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  apply: () => void;
}

function IconGroup({
  label,
  items,
  run,
  className,
}: {
  label: string;
  items: IconItem[];
  run: (command: () => void) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex rounded-xl bg-muted p-0.5", className)}>
      {items.map(({ label, icon: Icon, active, apply }) => (
        <button
          key={label}
          type="button"
          onMouseDown={keepFocus}
          onClick={() => run(apply)}
          title={label}
          aria-pressed={active}
          className={cn(PRESS, "flex h-11 min-w-11 flex-1 items-center justify-center rounded-[10px]", active && ACTIVE)}
        >
          <Icon className="size-5" />
        </button>
      ))}
    </div>
  );
}
