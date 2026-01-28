import { useNavigate, useParams } from "react-router-dom";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useWebLLM, type ChatMessage } from "@/hooks/useWebLLM";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ChevronLeft,
  Bot,
  Send,
  Loader2,
  MessageCircle,
  Globe,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotes } from "@/hooks/useNotes";
import { webSearch } from "@/lib/search/searchService";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const COMMANDS = [
  { label: "/summarize", description: "Summarize current note" },
  { label: "/search", description: "Search the web" },
  { label: "/clear", description: "Clear chat history" },
  { label: "/help", description: "Show available commands" },
];

/**
 * Dedicated ChatBot page for mobile devices.
 * Provides full-screen chat experience with proper routing.
 */
export default function ChatBotPage() {
  const navigate = useNavigate();
  const { noteId, folderId } = useParams();

  // Local state for chat messages and generation status
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

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

  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showSearchConsent, setShowSearchConsent] = useState(false);
  const [pendingSearchQuery, setPendingSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Initialize on mount if not ready
  useEffect(() => {
    if (!isReady && !isModelLoading) {
      initialize();
    }
  }, [isReady, isModelLoading, initialize]);

  const filteredCommands = useMemo(() => {
    if (!input.startsWith("/")) return [];
    return COMMANDS.filter((cmd) =>
      cmd.label.toLowerCase().includes(input.toLowerCase())
    );
  }, [input]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInput(value);
      setShowSuggestions(value.startsWith("/") && value.length > 0);
      setSelectedIndex(0);
    },
    []
  );

  const selectCommand = useCallback((cmd: string) => {
    setInput(cmd + " ");
    setShowSuggestions(false);
  }, []);

  // Send a message to the AI and get a response
  const sendMessage = useCallback(async (content: string) => {
    const userMessage: ChatMessage = { role: "user", content };
    setMessages((prev) => [...prev, userMessage]);
    setIsGenerating(true);

    try {
      const response = await chat([...messages, userMessage]);
      const assistantMessage: ChatMessage = { role: "assistant", content: response };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("[ChatBot] Error:", error);
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsGenerating(false);
    }
  }, [chat, messages]);

  const clearHistory = useCallback(() => {
    setMessages([]);
  }, []);

  const performSearch = useCallback(
    async (query: string) => {
      setIsSearching(true);
      try {
        const results = await webSearch(query);
        if (results.length > 0) {
          const formattedResults = results
            .map(
              (r, i) =>
                `${i + 1}. [${r.title}](${r.url})\n   ${(r.snippet || "").slice(0, 150)}...`
            )
            .join("\n\n");

          const searchContext = `Here are web search results for "${query}":\n\n${formattedResults}\n\nBased on these results, please provide a comprehensive answer.`;
          await sendMessage(searchContext);
        } else {
          await sendMessage(
            `I couldn't find any web results for "${query}". Let me try to answer based on my knowledge.`
          );
        }
      } catch {
        await sendMessage(
          "Web search failed. Please check your connection and try again."
        );
      } finally {
        setIsSearching(false);
      }
    },
    [sendMessage]
  );

  const confirmSearch = useCallback(() => {
    setShowSearchConsent(false);
    if (pendingSearchQuery) {
      performSearch(pendingSearchQuery);
    }
  }, [pendingSearchQuery, performSearch]);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    setInput("");
    setShowSuggestions(false);

    // Handle commands
    if (trimmed.startsWith("/help")) {
      const helpText = `Available commands:\n${COMMANDS.map((c) => `• ${c.label}: ${c.description}`).join("\n")}`;
      await sendMessage(helpText);
      return;
    }

    if (trimmed.startsWith("/clear")) {
      clearHistory();
      return;
    }

    if (trimmed.startsWith("/summarize")) {
      if (noteId) {
        const note = notes.find((n) => n.docId === noteId);
        if (note?.plainTextContent) {
          await sendMessage(
            `Please summarize this note:\n\n${note.plainTextContent.slice(0, 2000)}`
          );
        } else {
          await sendMessage("No note content found to summarize.");
        }
      } else {
        await sendMessage("Please open a note first to use /summarize.");
      }
      return;
    }

    if (trimmed.startsWith("/search")) {
      const query = trimmed.replace("/search", "").trim();
      if (query) {
        setPendingSearchQuery(query);
        setShowSearchConsent(true);
      } else {
        await sendMessage(
          "Please provide a search query. Usage: /search [query]"
        );
      }
      return;
    }

    // Normal message
    await sendMessage(trimmed);
  }, [input, sendMessage, clearHistory, noteId, notes]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showSuggestions && filteredCommands.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % filteredCommands.length);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex(
            (i) => (i - 1 + filteredCommands.length) % filteredCommands.length
          );
        } else if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          selectCommand(filteredCommands[selectedIndex].label);
        } else if (e.key === "Escape") {
          setShowSuggestions(false);
        }
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [showSuggestions, filteredCommands, selectedIndex, selectCommand, handleSend]
  );

  const handleBack = () => {
    if (folderId && noteId) {
      navigate(`/${folderId}/${noteId}`);
    } else if (folderId) {
      navigate(`/${folderId}`);
    } else {
      navigate("/");
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="flex items-center h-12 px-3 border-b border-border gap-2 shrink-0 pt-[env(safe-area-inset-top)] bg-muted/30">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleBack}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        <div className="flex items-center gap-2 flex-1">
          <Bot className="w-5 h-5 text-primary" />
          <span className="font-medium text-sm">Assistant</span>
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
                  <p className="text-sm">AI model needs to be initialized.</p>
                  <Button onClick={() => initialize()} variant="outline" size="sm">
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
              <p className="text-xs mt-2">Type /help for available commands.</p>
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
        {showSuggestions && filteredCommands.length > 0 && (
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
            placeholder={isReady ? "Type a message or /help..." : "Waiting for AI..."}
            disabled={!isReady || isGenerating || isSearching}
            className="flex-1 h-9 text-sm"
          />
          <Button
            size="icon"
            className="h-9 w-9"
            onClick={handleSend}
            disabled={!isReady || (isGenerating && !isSearching) || !input.trim()}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Search Consent Dialog */}
      <Dialog open={showSearchConsent} onOpenChange={setShowSearchConsent}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-5 h-5 text-blue-500" />
              Enable Web Search?
            </DialogTitle>
            <DialogDescription className="pt-2">
              You are about to use the web search feature. Unlike the AI chat
              which runs purely on your device, this will send your query to an
              external search provider.
            </DialogDescription>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg border border-yellow-200 dark:border-yellow-900/50 flex gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-500 shrink-0" />
              <p className="text-sm text-yellow-700 dark:text-yellow-400">
                Your search query "{pendingSearchQuery}" will be sent to a public
                SearXNG instance.
              </p>
            </div>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowSearchConsent(false)}>
              Cancel
            </Button>
            <Button onClick={confirmSearch}>I Understand, Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
