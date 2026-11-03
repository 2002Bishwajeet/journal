import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  X,
  Send,
  Loader2,
  Bot,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Square,
  Search,
  FileText,
  List,
  Wrench,
  CircleAlert,
  PencilLine,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { SUMMARIZE_REQUEST, countToolSteps, useAgentSession, type AgentStep } from "@/hooks/useAgentSession";
import { aiRequests } from "@/lib/agent/aiRequests";
import ModelDownloadDialog from "@/components/modals/ModelDownloadDialog";
import { AgentWriteCard } from "@/components/layout/AgentWriteCard";
import { ExperimentalBadge, LocalAINote } from "@/components/LocalAIExperimental";

interface ChatBotProps {
  activeNoteId?: string | null;
}

/** A step's kind of tool, read from its wording (useAgentSession's describeCall). The rest are edits. */
const STEP_ICONS: [string, LucideIcon][] = [
  ["Searched", Search],
  ["Read", FileText],
  ["Listed", List],
  ["Used", Wrench],
  ["Could not", CircleAlert],
];

/** Focus ring for the panel's controls, full strength in both themes. */
const FOCUS_RING = "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function StepText({ step }: { step: AgentStep }) {
  return (
    <>
      {step.before}
      {step.note && (
        <Link to={step.note.href} className={cn("rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none", FOCUS_RING)}>
          {step.note.title}
        </Link>
      )}
      {step.after}
    </>
  );
}

/**
 * One step: a small icon for its kind of tool, then what it did. While the turn runs (`live`), a
 * tool that has not answered shows a spinner, and a proposal waiting for the user's answer stands out.
 */
function StepRow({ step, live = false }: { step: AgentStep; live?: boolean }) {
  const waiting = live && step.open && step.summary !== undefined;
  const running = live && step.open && !waiting;
  const Icon = running ? Loader2 : (STEP_ICONS.find(([prefix]) => step.before.startsWith(prefix))?.[1] ?? PencilLine);
  return (
    <li className={cn("flex gap-2", waiting && "font-medium text-foreground")}>
      <Icon
        aria-hidden="true"
        className={cn("mt-px size-3.5 shrink-0", running && "animate-spin", Icon === CircleAlert && "text-destructive dark:text-red-400")}
      />
      <span className="min-w-0 break-words">
        <StepText step={step} />
      </span>
    </li>
  );
}

export function ChatBot({ activeNoteId }: ChatBotProps) {
  const [isOpen, setIsOpen] = useState(false);

  const {
    messages,
    input,
    setInput,
    isGenerating,
    modelStatus,
    downloadDialogProps,
    suggestions,
    send,
    submit,
    stop,
    selectCommand,
    handleKeyDown,
  } = useAgentSession(activeNoteId ?? undefined);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const stopButtonRef = useRef<HTMLButtonElement>(null);

  // The /ask and /summarize slash commands in the note open the panel (#703).
  useEffect(
    () =>
      aiRequests.subscribe((request) => {
        if (request === "rewrite") return;
        setIsOpen(true);
        if (request === "summarize") void submit(SUMMARIZE_REQUEST);
        else requestAnimationFrame(() => inputRef.current?.focus());
      })
  );

  // While the panel is open, html[data-assistant] keeps toasts clear of it (#840).
  useEffect(() => {
    if (!isOpen) return;
    document.documentElement.dataset.assistant = "";
    return () => {
      delete document.documentElement.dataset.assistant;
    };
  }, [isOpen]);

  const scrollToBottom = () => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    messagesEndRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
      // The control that had focus went away (the download dialog's Continue, a card's buttons, Stop):
      // keep focus in the panel, on Stop while a turn runs and on the message box after it.
      if (document.activeElement === document.body) (isGenerating ? stopButtonRef : inputRef).current?.focus();
    }
  }, [messages, isOpen, isGenerating, modelStatus]);

  // Focus moves into the panel when it opens and back to the button that opens it when it closes.
  const open = () => {
    setIsOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const close = () => {
    setIsOpen(false);
    requestAnimationFrame(() => openButtonRef.current?.focus());
  };

  const percent = modelStatus ? Math.round(modelStatus.progress * 100) : 0;

  return (
    <>
      {isOpen && (
        // Below lg it fills the screen; from lg it is a column beside the note that narrows the editor.
        <div
          role="region"
          aria-label="Assistant"
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background animate-in slide-in-from-bottom-full fade-in duration-300 lg:static lg:z-auto lg:h-full lg:w-90 lg:shrink-0 lg:animate-none lg:border-l lg:border-border"
        >
          {/* Header - Mobile/Tablet with back button, Desktop with X. From lg it lines up with the tab bar. */}
          <div className="flex items-center h-12 px-3 border-b border-border gap-2 shrink-0 pt-[env(safe-area-inset-top)] lg:pt-0 bg-muted/30 lg:h-9 lg:pr-1">
            {/* Mobile/Tablet: Back button */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close assistant"
              className={cn("h-8 w-8 lg:hidden", FOCUS_RING)}
              onClick={close}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>

            <h2 className="flex items-center gap-2 flex-1 font-medium text-sm">
              <Bot aria-hidden="true" className="w-4 h-4 text-muted-foreground" />
              Assistant
              <ExperimentalBadge />
            </h2>

            {/* Desktop: X close button */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close assistant"
              className={cn("h-7 w-7 hidden lg:flex", FOCUS_RING)}
              onClick={close}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Messages. New steps, proposals and their answers are read out as they appear. */}
          <ScrollArea className="flex-1 min-h-0">
            <div role="log" aria-live="polite" className="flex flex-col gap-6 p-4 min-h-full text-sm">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center gap-1 flex-1 text-center py-12">
                  <MessageCircle aria-hidden="true" className="size-8 mb-3 text-muted-foreground/70" />
                  <p className="font-medium">Ask me anything about your notes!</p>
                  <p className="text-xs text-muted-foreground">
                    Type /help for available commands.
                  </p>
                  <LocalAINote className="mt-4 max-w-72 text-xs leading-relaxed" />
                </div>
              )}

              {messages.map((msg, i) => {
                if (msg.role === "user") {
                  return (
                    <p key={i} className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-muted px-3.5 py-2">
                      {msg.content}
                    </p>
                  );
                }
                const steps = msg.steps ?? [];
                const last = steps.at(-1);
                const toolSteps = countToolSteps(steps);
                return (
                  <div key={i} className="flex flex-col gap-3">
                    {msg.pending && modelStatus ? (
                      // Loading the model: a bar for the progress. Not read out on every percent.
                      <div aria-live="off" className="flex flex-col gap-2 text-xs text-muted-foreground">
                        <span>{`${modelStatus.message || "Loading AI model..."} ${percent}%`}</span>
                        <div aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-border">
                          <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${percent}%` }} />
                        </div>
                      </div>
                    ) : msg.pending ? (
                      // Running: each step as it happens; a running tool or the model's next turn shows a spinner.
                      <ol className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                        {steps.map((step, j) => (
                          <StepRow key={j} step={step} live />
                        ))}
                        {!last?.open && (
                          <li className="flex gap-2">
                            <Loader2 aria-hidden="true" className="mt-px size-3.5 shrink-0 animate-spin" />
                            <span>Thinking...</span>
                          </li>
                        )}
                      </ol>
                    ) : (
                      steps.length > 0 && (
                        <details className="group text-xs text-muted-foreground">
                          <summary
                            className={cn(
                              "inline-flex cursor-pointer select-none list-none items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none [&::-webkit-details-marker]:hidden",
                              FOCUS_RING
                            )}
                          >
                            <ChevronRight aria-hidden="true" className="size-3.5 transition-transform duration-200 group-open:rotate-90" />
                            {toolSteps === 0 ? "Error" : `${toolSteps} ${toolSteps === 1 ? "step" : "steps"}`}
                          </summary>
                          <ol className="mt-2 ml-1.5 flex flex-col gap-1.5 border-l border-border pl-3">
                            {steps.map((step, j) => (
                              <StepRow key={j} step={step} />
                            ))}
                          </ol>
                        </details>
                      )
                    )}
                    {steps.map((step, j) => step.write && <AgentWriteCard key={j} step={step} />)}
                    {!msg.pending && <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.content}</p>}
                  </div>
                );
              })}
              <div ref={messagesEndRef} className="h-1" />
            </div>
          </ScrollArea>

          {/* Input Area */}
          <div className="p-3 border-t bg-background shrink-0 relative pb-[max(12px,env(safe-area-inset-bottom))]">
            {/* Command Suggestions Popup */}
            {suggestions.open && (
              <div className="absolute bottom-full left-3 w-64 mb-2 bg-popover text-popover-foreground border rounded-md shadow-lg overflow-hidden z-50">
                <div className="py-1">
                  {suggestions.items.map((cmd, index) => (
                    <div
                      key={cmd.label}
                      className={cn(
                        "px-3 py-2 text-sm cursor-pointer flex flex-col hover:bg-muted/50",
                        index === suggestions.selectedIndex && "bg-muted"
                      )}
                      onClick={() => selectCommand(cmd.label)}
                      onMouseEnter={() => suggestions.setSelectedIndex(index)}
                    >
                      <span className="font-medium">{cmd.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {cmd.description}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Input
                ref={inputRef}
                aria-label="Message"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message or /help..."
                disabled={isGenerating}
                className="flex-1 h-9 text-sm"
              />
              {isGenerating ? (
                // Keyed apart, so a focused Stop leaves the page instead of turning into a disabled Send.
                <Button
                  key="stop"
                  ref={stopButtonRef}
                  size="icon"
                  variant="outline"
                  aria-label="Stop"
                  className={cn("h-9 w-9", FOCUS_RING)}
                  onClick={stop}
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </Button>
              ) : (
                <Button
                  key="send"
                  size="icon"
                  aria-label="Send message"
                  className={cn("h-9 w-9", FOCUS_RING)}
                  onClick={send}
                  disabled={!input.trim()}
                >
                  <Send className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {!isOpen && (
        <div className="fixed z-50 bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 flex flex-col items-end gap-2">
            <Button
            ref={openButtonRef}
            size="lg"
            aria-label="Open assistant"
            className={cn("rounded-full h-14 w-14 shadow-lg animate-in fade-in zoom-in duration-300", FOCUS_RING)}
            onClick={open}
            >
            <MessageCircle className="w-6 h-6" />
            </Button>
        </div>
      )}

      <ModelDownloadDialog {...downloadDialogProps} />
    </>
  );
}
