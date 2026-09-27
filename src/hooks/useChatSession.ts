import { useState } from "react";
import { useWebLLM, type ChatMessage } from "@/hooks/useWebLLM";
import { useNotes } from "@/hooks/useNotes";
import { getSearchIndexEntry } from "@/lib/db";
import { webSearch } from "@/lib/search/searchService";
import { readString, writeString, SEARCH_CONSENT_KEY } from "@/lib/storage";

export interface ChatCommand {
  label: string;
  description: string;
}

export const COMMANDS: ChatCommand[] = [
  { label: "/summarize", description: "Summarize current note" },
  { label: "/search", description: "Search the web" },
  { label: "/clear", description: "Clear chat history" },
  { label: "/help", description: "Show available commands" },
];

/**
 * Chat state and behaviour for the ChatBot panel: per-note history, command
 * autocomplete, web-search consent and message sending. `ChatBot.tsx` only
 * renders — everything here moved out of it verbatim (issue #233).
 */
export function useChatSession(activeNoteId: string | undefined) {
  const [input, setInputValue] = useState("");
  // Per-note chat history - keyed by activeNoteId, session-based (lost on app close)
  const [chatHistories, setChatHistories] = useState<Record<string, ChatMessage[]>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  // Search consent state
  const [showSearchConsent, setShowSearchConsent] = useState(false);
  const [pendingSearchQuery, setPendingSearchQuery] = useState<string | null>(null);

  // Command Auto-complete state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Derive current messages from chatHistories based on activeNoteId
  const noteKey = activeNoteId ?? "__global__";
  const messages = chatHistories[noteKey] ?? [];

  // Filtered commands are derived from input rather than kept in their own state.
  const filteredCommands = input.startsWith("/")
    ? COMMANDS.filter((c) => c.label.startsWith(input.toLowerCase()))
    : [];

  // Helper to update messages for current note
  const setMessages = (
    updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => {
    setChatHistories((prev) => {
      const currentMessages = prev[noteKey] ?? [];
      const newMessages =
        typeof updater === "function" ? updater(currentMessages) : updater;
      return { ...prev, [noteKey]: newMessages };
    });
  };

  const {
    chat,
    isReady,
    initialize,
    isLoading,
    loadingProgress,
    loadingMessage,
  } = useWebLLM();
  const {
    get: { data: notes = [] },
  } = useNotes();

  const setInput = (val: string) => {
    setInputValue(val);

    if (val.startsWith("/")) {
      const search = val.toLowerCase();
      const matches = COMMANDS.filter((c) => c.label.startsWith(search));
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

  const clearHistory = () => {
    setMessages([]);
  };

  const performSearch = async (query: string) => {
    setIsSearching(true);
    setMessages((prev) => [...prev, { role: "assistant", content: "🔍 Searching the web..." }]);

    try {
      const results = await webSearch(query);

      // Remove the "Searching..." message
      setMessages((prev) => {
        const lastMsg = prev[prev.length - 1];
        if (lastMsg && lastMsg.content === "🔍 Searching the web...") {
          return prev.slice(0, -1);
        }
        return prev;
      });

      if (results.length === 0) {
        setMessages((prev) => [...prev, { role: "assistant", content: "I couldn't find any results for that query." }]);
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

      setMessages((prev) => [...prev, { role: "assistant", content: response }]);

    } catch (error) {
      console.error("Search failed:", error);
      setMessages((prev) => {
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
    writeString(SEARCH_CONSENT_KEY, "true");
    setShowSearchConsent(false);
    if (pendingSearchQuery) {
      performSearch(pendingSearchQuery);
      setPendingSearchQuery(null);
    }
  };

  const cancelSearch = () => {
    setShowSearchConsent(false);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || isGenerating || isSearching) return;

    setShowSuggestions(false);

    // Command handling
    if (text.startsWith("/")) {
      setInputValue("");
      const parts = text.split(" ");
      const command = parts[0].toLowerCase();
      // Combine all arguments into the query string
      const args = parts.slice(1).join(" ");

      if (command === "/clear") {
        clearHistory();
        return;
      }

      if (command === "/search") {
        if (!args) {
           setMessages((prev) => [...prev, { role: "user", content: text }, { role: "assistant", content: "Please provide a search query. Example: /search latest AI news" }]);
           return;
        }

        setMessages((prev) => [...prev, { role: "user", content: text }]);

        // Check consent
        const hasConsent = readString(SEARCH_CONSENT_KEY) === "true";
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
    setInputValue("");
    setIsGenerating(true);

    try {
      // Construct context — fetch full content from DB to avoid using truncated preview
      const fullEntry = activeNoteId ? await getSearchIndexEntry(activeNoteId) : null;
      const recentNotes = notes
        .slice(0, 30)
        .map((n) => `- ${n.title}`)
        .join("\n");

      const systemContext = `You are a helpful assistant for a personal journal app. Answer questions based ONLY on the provided context below. If you don't know or the information isn't in the context, say so honestly.

${
  fullEntry
    ? `CURRENT NOTE:
Title: ${fullEntry.title}
Content:
${fullEntry.plainTextContent?.slice(0, 2000) || "(empty)"}
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
      send();
    }
  };

  return {
    messages,
    input,
    setInput,
    isGenerating,
    isSearching,
    suggestions: {
      open: showSuggestions,
      items: filteredCommands,
      selectedIndex,
      setSelectedIndex,
    },
    consent: {
      open: showSearchConsent,
      query: pendingSearchQuery,
      confirm: confirmSearch,
      cancel: cancelSearch,
    },
    send,
    selectCommand,
    handleKeyDown,
    clearHistory,
    // useWebLLM status fields the panel reads
    isReady,
    isLoading,
    loadingProgress,
    loadingMessage,
    initialize,
  };
}
