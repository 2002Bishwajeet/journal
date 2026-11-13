/**
 * Mobile Toolbar Component
 *
 * Sits on top of the keyboard on touch devices while the editor has focus. It changes with
 * the selection, like Apple Notes (#1272): an insert bar at the caret, a format bar over a
 * text selection, and the Aa button swaps the keyboard for the style panel.
 *
 * Features:
 * - Safe area inset handling for notched devices (only while no keyboard is up)
 * - 44px+ touch targets, and no horizontal scroll at 390px
 */

import { useEffect, useRef, useState } from "react";
import { Editor, useEditorState } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  RemoveFormatting,
  List,
  ListTodo,
  Code,
  Link as LinkIcon,
  Image as ImageIcon,
  KeyboardOff,
  Sparkles,
  ALargeSmall,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useKeyboardOffset } from "@/hooks/useKeyboardOffset";
import { MOBILE_TOOLBAR_GAP } from "@/lib/editor/keyboardOffset";
import { getMobileBar, getStylePanelHeight } from "@/lib/editor/mobileBar";
import { aiRequests } from "@/lib/agent/aiRequests";
import { useSwipeToDismissKeyboard } from "@/hooks/useSwipeToDismissKeyboard";
import { useToolbarOverscroll } from "@/hooks/useToolbarOverscroll";
import { useDeviceType } from "@/hooks/useDeviceType";
import { ToolbarButton, useToolbarState, safeEditorCommand } from "./shared";
import { LinkSheet } from "./LinkSheet";
import { TablePicker } from "./TablePicker";
import { MobileStylePanel } from "./MobileStylePanel";

interface MobileToolbarProps {
  editor: Editor;
  className?: string;
}

const V = "mobile" as const;
/** Buttons share the row's width, never narrower than a 44px target. */
const FILL = "w-auto min-w-11 flex-1";
const CAPSULE =
  "pointer-events-auto flex items-center rounded-full border border-border bg-card/90 shadow-lg backdrop-blur-md";

export default function MobileToolbar({
  editor,
  className,
}: MobileToolbarProps) {
  const [hasFocus, setHasFocus] = useState(() => editor.isFocused);
  const [linkOpen, setLinkOpen] = useState(false);
  // The Aa panel, open in place of the keyboard, at the keyboard's height (null: unknown).
  const [stylePanel, setStylePanel] = useState<{ height: number | null } | null>(null);
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);

  // Use shared toolbar state hook
  const state = useToolbarState(editor);
  // Read on every transaction, so the bar swaps in the same frame as the selection.
  const bar = useEditorState({ editor, selector: ({ editor: ed }) => getMobileBar(ed.state.selection) });

  // Check if we're on a touch device
  const isTouchDevice =
    "ontouchstart" in window || navigator.maxTouchPoints > 0;
  // On desktop widths (an iPad in landscape) the editor page shows the full toolbar at the top
  const isDesktop = useDeviceType() === "desktop";

  // Show while the editor (or a picker opened from this toolbar) has focus,
  // in every keyboard mode: the keyboard height is not a reliable signal.
  useEffect(() => {
    const inEditorUi = (target: EventTarget | null) =>
      target instanceof Element &&
      (editor.view.dom.contains(target) ||
        !!target.closest("[data-mobile-toolbar], [data-radix-popper-content-wrapper]"));
    // A sheet opened from the editor (link, emoji, table...) takes focus, but the toolbar that
    // holds its state has to stay: focus moving into or out of a sheet changes nothing (#827).
    const inSheet = (target: EventTarget | null) =>
      target instanceof Element && !!target.closest('[data-slot="sheet-content"]');
    const onFocusIn = (e: FocusEvent) => {
      if (inSheet(e.target)) return;
      setHasFocus(inEditorUi(e.target));
      // Back in the note, the keyboard is up again: the style panel goes.
      if (e.target instanceof Node && editor.view.dom.contains(e.target)) setStylePanel(null);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (inSheet(e.target) || inSheet(e.relatedTarget)) return;
      const stays = inEditorUi(e.relatedTarget);
      setHasFocus(stays);
      if (!stays) setStylePanel(null);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [editor]);

  const isVisible = isTouchDevice && !isDesktop && hasFocus;
  // The open panel counts as the keyboard: the toolbar and the end of the note stay above it.
  useKeyboardOffset(isVisible, editor.view.dom, panelEl);
  useSwipeToDismissKeyboard(editor, isVisible);
  const rowRef = useRef<HTMLDivElement>(null);
  const capsuleRef = useRef<HTMLDivElement>(null);
  useToolbarOverscroll(isVisible, rowRef, capsuleRef);
  // Focus on the panel closes the keyboard and keeps the toolbar (it is inside it).
  useEffect(() => {
    panelEl?.focus({ preventScroll: true });
  }, [panelEl]);

  const run = (command: () => void) => safeEditorCommand(editor, command);
  const toggleBold = () => run(() => editor.chain().focus().toggleBold().run());
  const toggleItalic = () => run(() => editor.chain().focus().toggleItalic().run());
  const toggleUnderline = () => run(() => editor.chain().focus().toggleUnderline().run());
  const toggleStrike = () => run(() => editor.chain().focus().toggleStrike().run());
  const toggleCode = () => run(() => editor.chain().focus().toggleCode().run());
  const clearFormatting = () => run(() => editor.chain().focus().clearNodes().unsetAllMarks().run());
  const toggleBulletList = () => run(() => editor.chain().focus().toggleBulletList().run());
  const toggleTaskList = () => run(() => editor.chain().focus().toggleTaskList().run());
  const addLink = () => setLinkOpen(true);
  const rewrite = () => aiRequests.emit("rewrite");

  const addImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      run(() => editor.chain().insertImageFiles(Array.from(input.files ?? [])).run());
    };
    input.click();
  };

  // Focus back in the note brings the keyboard back, with the selection the note kept.
  const closeStyles = () => {
    setStylePanel(null);
    run(() => editor.chain().focus().run());
  };
  const toggleStyles = () => {
    if (stylePanel) return closeStyles();
    const keyboard = parseFloat(document.documentElement.style.getPropertyValue("--keyboard-offset")) || 0;
    setStylePanel({ height: getStylePanelHeight(keyboard) });
  };
  const hideKeyboard = () => {
    if (panelEl) panelEl.blur();
    else editor.chain().blur().run();
  };

  // Don't render on non-touch devices, at desktop widths or when the editor has no focus
  if (!isVisible) return null;

  return (
    // Floats above the keyboard: one capsule of tools. The row itself lets touches
    // through to the note around it.
    <div
      className={cn("fixed inset-x-0 z-50 flex items-center pointer-events-none", className)}
      data-mobile-toolbar
      style={{
        bottom: `calc(var(--keyboard-offset, 0px) + var(--keyboard-safe-bottom, env(safe-area-inset-bottom, 0px)) + ${MOBILE_TOOLBAR_GAP}px)`,
        paddingLeft: "max(12px, env(safe-area-inset-left, 0px))",
        paddingRight: "max(12px, env(safe-area-inset-right, 0px))",
      }}
    >
      {/* The slash menu docks here, above the toolbar, while the editor keeps focus (#827) */}
      <div data-slash-dock className="pointer-events-auto absolute inset-x-0 bottom-full empty:hidden" />
      <LinkSheet editor={editor} open={linkOpen} onOpenChange={setLinkOpen} />
      {stylePanel && (
        <MobileStylePanel ref={setPanelEl} editor={editor} state={state} height={stylePanel.height} onClose={closeStyles} />
      )}
      <div ref={capsuleRef} className={cn(CAPSULE, "min-w-0 flex-1 overflow-hidden p-1")}>
        {/* Fits at 390px; a narrower phone scrolls it. Past the ends useToolbarOverscroll
            rubber-bands it, the same on iOS and Android, so the browser's own bounce is off. */}
        <div ref={rowRef} className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-none scrollbar-hide">
          {/* Swaps in place when the selection changes; the new bar fades in. */}
          <div
            key={bar}
            data-bar={bar}
            className="flex min-w-full items-center animate-in fade-in duration-(--duration-fade) ease-(--ease-standard)"
          >
            {bar === "format" ? (
              <>
                <ToolbarButton variant={V} className={FILL} onClick={toggleBold} isActive={state.isBold} title="Bold">
                  <Bold className="h-5 w-5" />
                </ToolbarButton>
                <ToolbarButton variant={V} className={FILL} onClick={toggleItalic} isActive={state.isItalic} title="Italic">
                  <Italic className="h-5 w-5" />
                </ToolbarButton>
                <ToolbarButton variant={V} className={FILL} onClick={toggleUnderline} isActive={state.isUnderline} title="Underline">
                  <Underline className="h-5 w-5" />
                </ToolbarButton>
                <ToolbarButton variant={V} className={FILL} onClick={toggleStrike} isActive={state.isStrike} title="Strikethrough">
                  <Strikethrough className="h-5 w-5" />
                </ToolbarButton>
                <ToolbarButton variant={V} className={FILL} onClick={addLink} isActive={state.isLink} title="Add Link">
                  <LinkIcon className="h-5 w-5" />
                </ToolbarButton>
                <ToolbarButton variant={V} className={FILL} onClick={toggleCode} isActive={state.isCode} title="Code">
                  <Code className="h-5 w-5" />
                </ToolbarButton>
                <ToolbarButton variant={V} className={FILL} onClick={clearFormatting} title="Clear Formatting">
                  <RemoveFormatting className="h-5 w-5" />
                </ToolbarButton>
                <ToolbarButton variant={V} className={FILL} onClick={rewrite} title="Rewrite with AI">
                  <Sparkles className="h-5 w-5" />
                </ToolbarButton>
              </>
            ) : (
              <>
                {/* Room for one more 44px button here: the voice-note mic (#1258). */}
                <ToolbarButton variant={V} className={FILL} onClick={toggleTaskList} isActive={state.isTaskList} title="Checklist">
                  <ListTodo className="h-5 w-5" />
                </ToolbarButton>
                <ToolbarButton variant={V} className={FILL} onClick={toggleBulletList} isActive={state.isBulletList} title="Bullet List">
                  <List className="h-5 w-5" />
                </ToolbarButton>
                <ToolbarButton variant={V} className={FILL} onClick={addImage} title="Add Image">
                  <ImageIcon className="h-5 w-5" />
                </ToolbarButton>
                <TablePicker
                  editor={editor}
                  iconSize={20}
                  className={cn(FILL, "flex h-12 items-center justify-center rounded-full p-0 text-foreground active:bg-primary/20 touch-manipulation")}
                />
                <ToolbarButton variant={V} className={FILL} onClick={addLink} isActive={state.isLink} title="Add Link">
                  <LinkIcon className="h-5 w-5" />
                </ToolbarButton>
                <ToolbarButton variant={V} className={FILL} onClick={toggleStyles} isActive={!!stylePanel} title="Text Styles">
                  <ALargeSmall className="h-5 w-5" />
                </ToolbarButton>
              </>
            )}
          </div>
        </div>
        {/* With the keyboard up there is no other way to close it. Focus is on the editor,
            so the toolbar (and this button) only shows while the keyboard is. */}
        {bar === "insert" && (
          <ToolbarButton variant={V} className="shrink-0" onClick={hideKeyboard} title="Hide keyboard">
            <KeyboardOff className="h-5 w-5" />
          </ToolbarButton>
        )}
      </div>
    </div>
  );
}
