import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Send, Loader2, Bot, MessageCircle, ChevronLeft, Square } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAgentSession, type AgentStep } from "@/hooks/useAgentSession";
import ModelDownloadDialog from "@/components/modals/ModelDownloadDialog";
import { AgentWriteCard } from "@/components/layout/AgentWriteCard";

interface ChatBotProps {
  activeNoteId?: string | null;
}

function StepText({ step }: { step: AgentStep }) {
  return (
    <>
      {step.before}
      {step.note && (
        <Link to={step.note.href} className="underline underline-offset-2 hover:text-foreground">
          {step.note.title}
        </Link>
      )}
      {step.after}
    </>
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
    stop,
    selectCommand,
    handleKeyDown,
  } = useAgentSession(activeNoteId ?? undefined);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen, isGenerating, modelStatus]);

  const toggleChat = () => setIsOpen(!isOpen);

  return (
    <div className="z-50">
      {isOpen && (
        <div role="region" aria-label="Assistant" className="fixed inset-0 z-50 lg:inset-auto lg:bottom-20 lg:right-4 w-full h-full lg:w-100 lg:h-137.5 bg-background lg:border lg:rounded-lg shadow-xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-full lg:slide-in-from-bottom-2 fade-in duration-300">
          {/* Header - Mobile/Tablet with back button, Desktop with X */}
          <div className="flex items-center h-12 px-3 border-b border-border gap-2 shrink-0 pt-[env(safe-area-inset-top)] lg:pt-0 bg-muted/30">
            {/* Mobile/Tablet: Back button */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close assistant"
              className="h-8 w-8 lg:hidden"
              onClick={() => setIsOpen(false)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>

            <div className="flex items-center gap-2 flex-1">
              <Bot className="w-5 h-5 text-primary" />
              <span className="font-medium text-sm">Assistant</span>
            </div>

            {/* Desktop: X close button */}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close assistant"
              className="h-8 w-8 hidden lg:flex"
              onClick={() => setIsOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Messages Area */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="flex flex-col gap-4 p-4 min-h-full">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center flex-1 text-center text-muted-foreground text-sm py-12 opacity-60">
                  <MessageCircle className="w-12 h-12 mb-4 opacity-50" />
                  <p>Ask me anything about your notes!</p>
                  <p className="text-xs mt-2">
                    Type /help for available commands.
                  </p>
                </div>
              )}

              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex w-full",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}
                  >
                    {msg.pending ? (
                      <div className="text-xs flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                        <span>
                          {modelStatus
                            ? `${modelStatus.message || "Loading AI model..."} ${Math.round(modelStatus.progress * 100)}%`
                            : msg.steps?.length
                              ? <StepText step={msg.steps[msg.steps.length - 1]} />
                              : "Thinking..."}
                        </span>
                      </div>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                        {msg.steps && msg.steps.length > 0 && (
                          <details className="mt-2 text-xs text-muted-foreground">
                            <summary className="cursor-pointer select-none">
                              {msg.steps.length} {msg.steps.length === 1 ? "step" : "steps"}
                            </summary>
                            <ol className="mt-1 list-decimal pl-4 space-y-0.5">
                              {msg.steps.map((step, j) => (
                                <li key={j}>
                                  <StepText step={step} />
                                </li>
                              ))}
                            </ol>
                          </details>
                        )}
                      </>
                    )}
                    {msg.steps?.map((step, j) => step.write && <AgentWriteCard key={j} step={step} />)}
                  </div>
                </div>
              ))}
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
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message or /help..."
                disabled={isGenerating}
                className="flex-1 h-9 text-sm"
              />
              {isGenerating ? (
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Stop"
                  className="h-9 w-9"
                  onClick={stop}
                >
                  <Square className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  size="icon"
                  aria-label="Send message"
                  className="h-9 w-9"
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
        <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 flex flex-col items-end gap-2">
            <Button
            size="lg"
            aria-label="Open assistant"
            className="rounded-full h-14 w-14 shadow-lg animate-in fade-in zoom-in duration-300"
            onClick={toggleChat}
            >
            <MessageCircle className="w-6 h-6" />
            </Button>
        </div>
      )}

      <ModelDownloadDialog {...downloadDialogProps} />
    </div>
  );
}
