import { useEffect, useRef, useState } from "react";
import { useAISettings } from "@/hooks/useAISettings";
import { useModelDownloadGate } from "@/hooks/useModelDownloadGate";
import { getSearchIndexEntry } from "@/lib/db";
import type { AgentEvent } from "@/lib/agent/loop/agentLoop";
import { approveWrite, type WrittenNote } from "@/lib/agent/approveWrite";
import { e2eSwitches } from "@/lib/e2e/switches";

export interface ChatCommand {
  label: string;
  description: string;
}

export const COMMANDS: ChatCommand[] = [
  { label: "/summarize", description: "Summarize current note" },
  { label: "/clear", description: "Clear chat history" },
  { label: "/help", description: "Show available commands" },
];

export const SUMMARIZE_REQUEST = "Summarize the open note";

/** One tool call, in plain words: `before`, the note title as a link, `after`. */
export interface AgentStep {
  before: string;
  after: string;
  note?: { title: string; href: string };
  /** An edit to the open note: what the user is asked to accept or reject in the note. */
  summary?: string;
  /** An append to another note or a new note (#702): the card the user accepts or rejects in the panel. */
  write?: { markdown: string; state: "pending" | "accepted" | "rejected" | "notApplied"; note?: { title: string; href: string } };
  /** The tool was called and has not answered yet. */
  open?: boolean;
  /** An error row, not a tool step. */
  failed?: true;
}

/** The footer's step count: tool steps only, not the error row. */
export function countToolSteps(steps: AgentStep[]): number {
  return steps.filter((step) => !step.failed).length;
}

export interface ChatEntry {
  role: "user" | "assistant";
  content: string;
  steps?: AgentStep[];
  /** The assistant turn that is still running. */
  pending?: boolean;
}

function describeCall(tool: string, args: unknown): AgentStep {
  const { query } = (args ?? {}) as { query?: string };
  switch (tool) {
    case "search_notes":
      return { before: `Searched notes for '${query}'`, after: "" };
    case "get_note":
      return { before: "Read a note", after: "" };
    case "list_notes":
      return { before: "Listed notes", after: "" };
    case "append_to_note":
      return { before: "Prepared an addition to a note", after: "" };
    case "create_note":
      return { before: "Prepared a new note", after: "" };
    case "list_folders":
      return { before: "Listed folders", after: "" };
    case "read_open_note":
      return { before: "Read the open note", after: "" };
    case "insert_paragraph":
    case "set_block_type":
    case "replace_text":
    case "format_text":
      return { before: "Prepared an edit to the open note", after: "" };
    default:
      return { before: `Used ${tool}`, after: "" };
  }
}

/** The tool result is the data as JSON on its first line, then any advisory notes. */
function describeResult(step: AgentStep, tool: string, result: string, written?: WrittenNote): AgentStep {
  if (step.summary !== undefined) {
    const state = result.startsWith("accepted") ? "accepted" : result.startsWith("rejected") ? "rejected" : "notApplied";
    const outcome = { accepted: "Accepted", rejected: "Rejected", notApplied: "Not applied" }[state];
    const note = written && { title: written.title, href: `/${written.folderId}/${written.id}` };
    return {
      before: `${outcome}: ${step.summary}`,
      after: "",
      ...(step.write && { summary: step.summary, write: { ...step.write, state, note } }),
    };
  }
  if (tool !== "get_note") return step;
  try {
    const { id, folderId, title } = JSON.parse(result.split("\n")[0]);
    return { before: "Read '", note: { title, href: `/${folderId}/${id}` }, after: "'" };
  } catch {
    return step;
  }
}

/** Folds one loop event into the turn's steps. */
function applyEvent(steps: AgentStep[], event: AgentEvent): AgentStep[] {
  const last = steps.length - 1;
  switch (event.type) {
    case "toolCall":
      return [...steps, { ...describeCall(event.tool, event.args), open: true }];
    case "proposal":
      return steps.map((step, i) =>
        i === last && event.proposal.summary !== undefined
          ? {
              before: event.proposal.write ? "Waiting for your OK" : "Waiting for your OK in the note",
              after: "",
              summary: event.proposal.summary,
              ...(event.proposal.write && { write: { markdown: event.proposal.write.markdown, state: "pending" as const } }),
              open: true,
            }
          : step
      );
    case "toolResult":
      return steps.map((step, i) => (i === last ? { ...describeResult(step, event.tool, event.result, event.note), open: false } : step));
    case "error": {
      const failed = { before: `Could not finish a step: ${event.error.replace(/: [0-9a-f-]{36}$/i, "")}`, after: "", failed: true as const };
      // A tool that throws fails its own step; a bad reply from the model is a step of its own.
      const rest = steps[last]?.open ? steps.slice(0, last) : steps;
      // The same failure twice in a row shows as one row.
      return rest.at(-1)?.before === failed.before ? rest : [...rest, failed];
    }
    default:
      return steps;
  }
}

/**
 * Agent chat for the ChatBot panel: per-note history, command autocomplete, and a
 * request that `runAgent` answers by calling the notes tools on this device. The open
 * note's id and title ride along as context; the model reads its body with `get_note`.
 * `ChatBot.tsx` only renders.
 */
export function useAgentSession(activeNoteId: string | undefined) {
  const [input, setInputValue] = useState("");
  // Per-note chat history - keyed by activeNoteId, session-based (lost on app close)
  const [histories, setHistories] = useState<Record<string, ChatEntry[]>>({});
  // Set while the agent model downloads or loads inside a request.
  const [modelStatus, setModelStatus] = useState<{ progress: number; message: string } | null>(null);
  const controllers = useRef(new Map<string, AbortController>());

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { settings } = useAISettings();
  const { confirmDownload, dialogProps: downloadDialogProps } = useModelDownloadGate();

  const noteKey = activeNoteId ?? "__global__";
  const messages = histories[noteKey] ?? [];
  const isGenerating = messages.at(-1)?.pending === true;

  const filteredCommands = input.startsWith("/")
    ? COMMANDS.filter((c) => c.label.startsWith(input.toLowerCase()))
    : [];

  useEffect(() => {
    const running = controllers.current;
    return () => running.forEach((controller) => controller.abort());
  }, []);

  const update = (key: string, updater: (entries: ChatEntry[]) => ChatEntry[]) =>
    setHistories((prev) => ({ ...prev, [key]: updater(prev[key] ?? []) }));

  const setInput = (val: string) => {
    setInputValue(val);

    if (val.startsWith("/")) {
      const matches = COMMANDS.filter((c) => c.label.startsWith(val.toLowerCase()));
      setShowSuggestions(matches.length > 0);
      setSelectedIndex(0);
    } else {
      setShowSuggestions(false);
    }
  };

  const selectCommand = (cmd: string) => {
    setInput(cmd);
    setShowSuggestions(false);
  };

  const stop = () => controllers.current.get(noteKey)?.abort();

  const clearHistory = () => {
    stop();
    update(noteKey, () => []);
  };

  const reply = (text: string, content: string) =>
    update(noteKey, (entries) => [...entries, { role: "user", content: text }, { role: "assistant", content }]);

  const run = async (text: string, request: string) => {
    const key = noteKey;
    const controller = new AbortController();
    controllers.current.set(key, controller);
    update(key, (entries) => [
      ...entries,
      { role: "user", content: text },
      { role: "assistant", content: "", steps: [], pending: true },
    ]);

    let capped = false;
    let failure: string | undefined;
    let content: string;
    try {
      const [{ runAgent, toolsFor, MAX_TOOL_STEPS }, { approveEdit }, { createLocalWriteDeps }, { createAgentEngine }] =
        await Promise.all([
          import("@/lib/agent/loop/agentLoop"),
          import("@/lib/agent/approveEdit"),
          import("@/lib/agent/local/localWriteDeps"),
          import("@/lib/webllm"),
        ]);
      // A note kept from AI is not even named to the model.
      const entry = activeNoteId ? await getSearchIndexEntry(activeNoteId) : null;
      const context = entry && !entry.metadata.excludeFromAI ? `Open note: "${entry.title}" (id: ${entry.docId})\n` : "";

      const writeDeps = createLocalWriteDeps();
      const answer = await runAgent(context + request, {
        engine: createAgentEngine(settings.agentModelId, (report) =>
          setModelStatus({ progress: report.progress, message: report.text })
        ),
        deps: writeDeps,
        // Judged on what the user typed, not the note title in `context`.
        tools: toolsFor(request),
        writeDeps,
        // An edit to the open note shows in the note, an append to another note or a new note shows as a
        // card in this panel; the user accepts or rejects each.
        approve: (proposal) =>
          proposal.write ? approveWrite(proposal.write, controller.signal) : approveEdit(proposal, controller.signal),
        signal: controller.signal,
        onEvent: (event) => {
          e2eSwitches.onAgentEvent?.(event);
          if (event.type === "step" && event.step > MAX_TOOL_STEPS) capped = true;
          if (event.type === "failed") failure = event.message;
          if (event.type !== "step") setModelStatus(null);
          update(key, (entries) =>
            entries.map((e) => (e.pending ? { ...e, steps: applyEvent(e.steps ?? [], event) } : e))
          );
        },
      });

      if (controller.signal.aborted) content = "Stopped.";
      else if (failure) content = failure;
      else if (answer === null) content = `I ran out of steps (${MAX_TOOL_STEPS}) before I could answer.`;
      else content = capped ? `${answer}\n\nI stopped after ${MAX_TOOL_STEPS} steps, so this may be incomplete.` : answer;
    } catch (error) {
      console.error("Agent error:", error);
      content = controller.signal.aborted ? "Stopped." : "Sorry, I encountered an error. Please try again.";
    } finally {
      controllers.current.delete(key);
      setModelStatus(null);
    }
    update(key, (entries) => entries.map((e) => (e.pending ? { ...e, content, pending: false } : e)));
  };

  /** Sends `value` as the user's message. The Send button and Enter send the input; a slash command sends its own text. */
  const submit = async (value: string) => {
    const text = value.trim();
    if (!text || controllers.current.size > 0) return;

    setShowSuggestions(false);

    let request = text;
    if (text.startsWith("/")) {
      const command = text.split(" ")[0].toLowerCase();
      if (command === "/summarize" || command === "/summarise") {
        request = SUMMARIZE_REQUEST;
      } else {
        setInputValue("");
        if (command === "/clear") {
          clearHistory();
        } else if (command === "/help") {
          reply(
            text,
            "Ask a question about your notes. I look through them on this device to find the answer.\n\n/summarize - Summarize the current note\n/clear - Clear chat history\n/help - Show this help message"
          );
        } else {
          reply(text, `Unknown command '${command}'. Type /help for available commands.`);
        }
        return;
      }
    }

    if (!(await confirmDownload(settings.agentModelId))) return;
    setInputValue("");
    await run(text, request);
  };

  const send = () => submit(input);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSuggestions) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
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
    modelStatus,
    downloadDialogProps,
    suggestions: {
      open: showSuggestions,
      items: filteredCommands,
      selectedIndex,
      setSelectedIndex,
    },
    send,
    submit,
    stop,
    selectCommand,
    handleKeyDown,
    clearHistory,
  };
}
