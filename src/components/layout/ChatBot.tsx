import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useWebLLM, type ChatMessage } from "@/hooks/useWebLLM";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Send, Loader2, Bot, MessageCircle, ChevronLeft, Globe, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotes } from "@/hooks/useNotes";
import { webSearch } from "@/lib/search/searchService";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ChatBotProps {
  activeNoteId?: string | null;
}

const COMMANDS = [
  { label: "/summarize", description: "Summarize current note" },
  { label: "/search", description: "Search the web" },
  { label: "/clear", description: "Clear chat history" },
  { label: "/help", description: "Show available commands" },
];

export function ChatBot({ activeNoteId }: ChatBotProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  // Per-note chat history - keyed by activeNoteId, session-based (lost on app close)
  const [chatHistories, setChatHistories] = useState<Record<string, ChatMessage[]>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  
  // Search consent state
  const [showSearchConsent, setShowSearchConsent] = useState(false);
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string | null>(null);

  // Derive current messages from chatHistories based on activeNoteId
  const noteKey = activeNoteId ?? '__global__';
  // Memoize messages to prevent dependency changes on every render
  const messages = useMemo(() => chatHistories[noteKey] ?? [], [chatHistories, noteKey]);
  
  // Helper to update messages for current note
  const setMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setChatHistories(prev => {
      const currentMessages = prev[noteKey] ?? [];
      const newMessages = typeof updater === 'function' ? updater(currentMessages) : updater;
      return { ...prev, [noteKey]: newMessages };
    });
  }, [noteKey]);

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
  }, [messages, isOpen, isGenerating, isSearching]);

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
  
  const performSearch = async (query: string) => {
    setIsSearching(true);
    setMessages(prev => [...prev, { role: "assistant", content: "🔍 Searching the web..." }]);
    
    try {
      const results = await webSearch(query);
      
      // Remove the "Searching..." message
      setMessages(prev => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.content === "🔍 Searching the web...") {
          return prev.slice(0, -1);
        }
        return prev;
      });
      
      if (results.length === 0) {
        setMessages(prev => [...prev, { role: "assistant", content: "I couldn't find any results for that query." }]);
        setIsSearching(false);
        return;
      }
      
      // Construct search context
      const searchContext = results.map((r, i) => 
        `[${i+1}] ${r.title} (${r.source})\nURL: ${r.url}\n${r.snippet}`
      ).join("\n\n");
      
      const systemPrompt = `You are a helpful research assistant. Answer the user's question based ONLY on the search results below.
      
SEARCH RESULTS:
${searchContext}

INSTRUCTIONS:
1. Synthesize the information to answer the query: "${query}"
2. Cite your sources using [1], [2], etc.
3. Be concise and factual.
4. If the search results don't contain the answer, say so.
`;

      setIsGenerating(true);
      const response = await chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: "Please summarize what you found." }
      ]);
      
      setMessages(prev => [...prev, { role: "assistant", content: response }]);
      
    } catch (error) {
      console.error("Search failed:", error);
      setMessages(prev => {
        // Remove "Searching..." if distinct from prev
        const msgs = prev[prev.length - 1].content === "🔍 Searching the web..." ? prev.slice(0, -1) : prev;
        return [...msgs, { role: "assistant", content: "Sorry, the search failed. Please try again." }];
      });
    } finally {
      setIsSearching(false);
      setIsGenerating(false);
    }
  };

  const confirmSearch = () => {
    localStorage.setItem("journal-search-consent", "true");
    setShowSearchConsent(false);
    if (pendingSearchQuery) {
      performSearch(pendingSearchQuery);
      setPendingSearchQuery(null);
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isGenerating || isSearching) return;

    setShowSuggestions(false);

    // Command handling
    if (text.startsWith("/")) {
      setInput("");
      const parts = text.split(" ");
      const command = parts[0].toLowerCase();
      // Combine all arguments into the query string
      const args = parts.slice(1).join(" ");

      if (command === "/clear") {
        setMessages([]);
        return;
      }
      
      if (command === "/search") {
        if (!args) {
           setMessages(prev => [...prev, { role: "user", content: text }, { role: "assistant", content: "Please provide a search query. Example: /search latest AI news" }]);
           return;
        }
        
        setMessages(prev => [...prev, { role: "user", content: text }]);
        
        // Check consent
        const hasConsent = localStorage.getItem("journal-search-consent") === "true";
        if (!hasConsent) {
          setPendingSearchQuery(args);
          setShowSearchConsent(true);
          return;
        }
        
        performSearch(args);
        return;
      }

      if (command === "/help") {
        setMessages((prev) => [
          ...prev,
          { role: "user", content: text },
          {
            role: "assistant",
            content:
              "Available commands:\n\n/search <query> - Search the web\n/summarize - Summarize the current note\n/clear - Clear chat history\n/help - Show this help message",
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

      const systemContext = `You are a helpful assistant for a personal journal app. Answer questions based ONLY on the provided context below. If you don't know or the information isn't in the context, say so honestly.

${
  currentNote
    ? `CURRENT NOTE:
Title: ${currentNote.title}
Content:
${currentNote.plainTextContent?.slice(0, 2000) || "(empty)"}
`
    : "No note is currently open."
}

OTHER NOTES (titles only):
${recentNotes || "(none)"}

RULES:
- Be concise and helpful.
- Only use information from the context above.
- If asked about something not in your context, say "I don't have that information in your notes."
- Do not make up facts or content that isn't in the notes.
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
    <div className="z-50">
      {isOpen && (
        <div className="fixed inset-0 z-50 lg:inset-auto lg:bottom-20 lg:right-4 w-full h-full lg:w-100 lg:h-137.5 bg-background lg:border lg:rounded-lg shadow-xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-full lg:slide-in-from-bottom-2 fade-in duration-300">
          {/* Header - Mobile/Tablet with back button, Desktop with X */}
          <div className="flex items-center h-12 px-3 border-b border-border gap-2 shrink-0 pt-[env(safe-area-inset-top)] lg:pt-0 bg-muted/30">
            {/* Mobile/Tablet: Back button */}
            <Button
              variant="ghost"
              size="icon"
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
          <div className="p-3 border-t bg-background shrink-0 relative pb-[max(12px,env(safe-area-inset-bottom))]">
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

      <Dialog open={showSearchConsent} onOpenChange={setShowSearchConsent}>
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
                Your search query "{pendingSearchQuery}" will be sent to a public SearXNG instance.
              </p>
            </div>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowSearchConsent(false)}>
              Cancel
            </Button>
            <Button onClick={confirmSearch}>
              I Understand, Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
