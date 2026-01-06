import { useState, useRef, useEffect } from "react";
import { useWebLLM, type ChatMessage } from "@/hooks/useWebLLM";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Send, Loader2, Bot, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotes } from "@/hooks/useNotes";

interface ChatBotProps {
  activeNoteId?: string | null;
}

const COMMANDS = [
  { label: "/summarize", description: "Summarize current note" },
  { label: "/clear", description: "Clear chat history" },
  { label: "/help", description: "Show available commands" },
];

export function ChatBot({ activeNoteId }: ChatBotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Command Auto-complete state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState(COMMANDS);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const {
    chat,
    isReady,
    initialize,
    isLoading: isModelLoading,
    loadingProgress,
    loadingMessage,
  } = useWebLLM();
  const {
    get: { data: notes = [] },
  } = useNotes();

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen, isGenerating]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);

    if (val.startsWith("/")) {
      const search = val.toLowerCase();
      const matches = COMMANDS.filter((c) => c.label.startsWith(search));
      setFilteredCommands(matches);
      setShowSuggestions(matches.length > 0);
      setSelectedIndex(0);
    } else {
      setShowSuggestions(false);
    }
  };

  const selectCommand = (cmd: string) => {
    setInput(cmd);
    setShowSuggestions(false);
    // Optional: auto-focus back to input if needed, but Input has focus
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isGenerating) return;

    setShowSuggestions(false);

    // Command handling
    if (text.startsWith("/")) {
      setInput("");
      const command = text.toLowerCase().split(" ")[0];

      if (command === "/clear") {
        setMessages([]);
        return;
      }

      if (command === "/help") {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: text },
          {
            role: "assistant",
            content:
              "Available commands:\n\n/summarize - Summarize the current note\n/clear - Clear chat history\n/help - Show this help message",
          },
        ]);
        return;
      }

      if (command === "/summarize" || command === "/summarise") {
        // Let it fall through to AI processing but with a specific prompt
        // We'll show the command as the user message
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: text },
          {
            role: "assistant",
            content: `Unknown command '${command}'. Type /help for available commands.`,
          },
        ]);
        return;
      }
    }

    const userMessage: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsGenerating(true);

    try {
      // Construct context
      const currentNote = notes.find((n) => n.docId === activeNoteId);
      const recentNotes = notes
        .slice(0, 30)
        .map((n) => `- ${n.title}`)
        .join("\n");

      const systemContext = `You are a helpful AI assistant for a personal journal/notebook app.
You answer questions based on the user's notes context.

${
  currentNote
    ? `CURRENTLY OPEN NOTE:\nTitle: ${currentNote.title}\nContent: ${currentNote.plainTextContent}\n`
    : "No note is currently open."
}

RECENT NOTES (Titles only):
${recentNotes}

Instructions:
1. Answer the user's question helpfully and concisely.
2. If the user asks about the current note, use its content.
3. If the user asks about other notes, you only know their titles. You can mention that.
4. Use simple text formatting. Do not use complex markdown as it may not render perfectly.
`;

      // Handle specific command overrides for the AI prompt
      let finalPrompt = text;
      if (
        text.toLowerCase().startsWith("/summarize") ||
        text.toLowerCase().startsWith("/summarise")
      ) {
        finalPrompt = "Please provide a concise summary of the current note.";
      }

      const conversationHistory: ChatMessage[] = [
        { role: "system", content: systemContext },
        ...messages,
        // Use the interpreted prompt for the last message if it was a command, otherwise the original text
        { role: "user", content: finalPrompt },
      ];

      const response = await chat(conversationHistory);

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: response },
      ]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        );
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          selectCommand(filteredCommands[selectedIndex].label);
        }
        return;
      }
      if (e.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleChat = () => {
    if (!isOpen && !isReady && !isModelLoading) {
      initialize();
    }
    setIsOpen(!isOpen);
  };

  return (
    <div className="fixed bottom-20 md:bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {isOpen && (
        <div className="w-[90vw] md:w-100 h-[60vh] md:h-137.5 bg-background border rounded-lg shadow-xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-2 fade-in duration-300">
          {/* Header */}
          <div className="p-3 border-b flex items-center justify-between bg-muted/50 shrink-0">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-primary" />
              <span className="font-semibold text-sm">Assistant</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsOpen(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Messages Area */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="flex flex-col gap-4 p-4 min-h-full">
              {!isReady && (
                <div className="flex flex-col items-center justify-center flex-1 text-center space-y-4 py-8 text-muted-foreground">
                  {isModelLoading ? (
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
          <div className="p-3 border-t bg-background shrink-0 relative">
            {/* Command Suggestions Popup */}
            {showSuggestions && (
              <div className="absolute bottom-full left-3 w-64 mb-2 bg-popover text-popover-foreground border rounded-md shadow-lg overflow-hidden z-50">
                <div className="py-1">
                  {filteredCommands.map((cmd, index) => (
                    <div
                      key={cmd.label}
                      className={cn(
                        "px-3 py-2 text-sm cursor-pointer flex flex-col hover:bg-muted/50",
                        index === selectedIndex && "bg-muted"
                      )}
                      onClick={() => selectCommand(cmd.label)}
                      onMouseEnter={() => setSelectedIndex(index)}
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
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  isReady ? "Type a message or /help..." : "Waiting for AI..."
                }
                disabled={!isReady || isGenerating}
                className="flex-1 h-9 text-sm"
              />
              <Button
                size="icon"
                className="h-9 w-9"
                onClick={handleSend}
                disabled={!isReady || isGenerating || !input.trim()}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {!isOpen && (
        <Button
          size="lg"
          className="rounded-full h-14 w-14 shadow-lg animate-in fade-in zoom-in duration-300"
          onClick={toggleChat}
        >
          <MessageCircle className="w-6 h-6" />
        </Button>
      )}
    </div>
  );
}
