import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Send, Loader2, Bot, MessageCircle, ChevronLeft, Globe, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatSession } from "@/hooks/useChatSession";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ChatBotProps {
  activeNoteId?: string | null;
}

export function ChatBot({ activeNoteId }: ChatBotProps) {
  const [isOpen, setIsOpen] = useState(false);

  const {
    messages,
    input,
    setInput,
    isGenerating,
    isSearching,
    suggestions,
    consent,
    send,
    selectCommand,
    handleKeyDown,
    isReady,
    isLoading,
    loadingProgress,
    loadingMessage,
    initialize,
  } = useChatSession(activeNoteId ?? undefined);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen, isGenerating, isSearching]);

  const toggleChat = () => {
    if (!isOpen && !isReady && !isLoading) {
      initialize();
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className="z-50">
      {isOpen && (
        <div className="fixed inset-0 z-50 lg:inset-auto lg:bottom-20 lg:right-4 w-full h-full lg:w-100 lg:h-137.5 bg-background lg:border lg:rounded-lg shadow-xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-full lg:slide-in-from-bottom-2 fade-in duration-300">
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
              {!isReady && (
                <div className="flex flex-col items-center justify-center flex-1 text-center space-y-4 py-8 text-muted-foreground">
                  {isLoading ? (
                    <>
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium">
                          {loadingMessage || "Loading AI Model..."}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {Math.round(loadingProgress * 100)}%
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm">
                        AI model needs to be initialized.
                      </p>
                      <Button
                        onClick={() => initialize()}
                        variant="outline"
                        size="sm"
                      >
                        Initialize AI
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {messages.length === 0 && isReady && (
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
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted"
                    )}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {isGenerating && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-lg px-3 py-2 text-xs flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Thinking...</span>
                  </div>
                </div>
              )}
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
                placeholder={
                  isReady ? "Type a message or /help..." : "Waiting for AI..."
                }
                disabled={!isReady || isGenerating || isSearching}
                className="flex-1 h-9 text-sm"
              />
              <Button
                size="icon"
                aria-label="Send message"
                className="h-9 w-9"
                onClick={send}
                disabled={!isReady || (isGenerating && !isSearching) || !input.trim()}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {!isOpen && (
        <div className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 flex flex-col items-end gap-2">
            <Button
            size="lg"
            className="rounded-full h-14 w-14 shadow-lg animate-in fade-in zoom-in duration-300"
            onClick={toggleChat}
            >
            <MessageCircle className="w-6 h-6" />
            </Button>
        </div>
      )}

      <Dialog open={consent.open} onOpenChange={(open) => !open && consent.cancel()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-500" />
              Enable Web Search?
            </DialogTitle>
            <DialogDescription className="pt-2">
              You are about to use the web search feature. Unlike the AI chat which runs purely on your device, this will send your query to an external search provider.
            </DialogDescription>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg border border-yellow-200 dark:border-yellow-900/50 flex gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 shrink-0" />
              <p className="text-sm text-yellow-700 dark:text-yellow-400">
                Your search query "{consent.query}" will be sent to a public SearXNG instance.
              </p>
            </div>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={consent.cancel}>
              Cancel
            </Button>
            <Button onClick={consent.confirm}>
              I Understand, Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
