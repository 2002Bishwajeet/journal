# Journal AI Assistant Specification (V1)

## 1. Product Vision
A "Zero-Config," 100% local, privacy-centric AI assistant deeply integrated into the Journal app. It serves as a writing companion that offers context-aware suggestions, edits, and answers without data ever leaving the user's device.

## 2. Core Architecture

### 2.1 Model Strategy
- **Engine:** WebLLM (In-browser execution via WebGPU).
- **Model:** `Llama-3.2-1B-Instruct` (Fixed selection for V1).
- **Philosophy:** "One Model, Zero Config." The user should not need to tune parameters or select models.
- **Privacy:** 100% Local execution is non-negotiable. No API keys or remote offloading.

### 2.2 Context & Retrieval (V1 Scope)
- **Scope:** 
  - **Primary:** Full content of the currently active note.
  - **Secondary:** Titles of the 30 most recent notes.
- **Persistence:** None. Chat history is session-based and clears on reload or explicit clear command.
- **Concurrency:** The system accepts race conditions where document content might update while the AI is generating.

## 3. User Experience (UX)

### 3.1 Chat Interface
- **Access:** Floating action button (Sparkles/Message icon) toggles a responsive chat window.
  - **Mobile:** `bottom-20`, `w-[90vw]`, `h-[60vh]`.
  - **Desktop:** `bottom-4`, `w-[400px]`, `h-[550px]`.
- **Interaction:** Standard chat stream with system/user/assistant roles.
- **Commands:** 
  - `/clear`: Wipes session history.
  - `/summarize`: Generates a summary of the active note.
  - `/help`: Lists commands.
  - **Auto-suggestion:** Typing `/` triggers a popup menu for command discovery.

### 3.2 Editor Integration (The "Agentic" Layer)
- **In-Editor Trigger:** 
  - Typing `/` within the editor opens a unified Command Menu.
  - Menu includes standard formatting (H1, Bold) AND AI commands (Ask AI, Rewrite, Summarize).
- **Feedback Loop:**
  - **Processing:** Inline spinner appears at the cursor location while generating.
  - **Output:** AI generation is presented as a **Suggestion** overlay (highlighted text or diff view).
  - **Confirmation:** A "Tooltip" UI appears near the suggestion allowing:
    - **Accept:** Commits the change to the document.
    - **Reject:** Discards the suggestion and reverts view.

## 4. Technical Implementation

### 4.1 "Write Access" & Version Control
- **Mechanism:** Yjs transactions.
- **Safety Net:** 
  - Every "Accept" action triggers a Yjs history checkpoint named `"AI Rewrite Applied"`.
  - This allows granular undo/redo and restores confidence in destructive edits.
- **Suggestion Mode:** 
  - Implementation likely involves a TipTap `Decoration` or temporary `Node` that renders the proposed change visually without committing it to the permanent Yjs doc until accepted.

### 4.2 Multi-Modal Roadmap
- **V1:** Text-only processing. Images in notes are ignored by the context builder.
- **Future:** Architecture must allow swapping the model for a Vision-Language Model (VLM) to analyze image nodes within TipTap.

## 5. UI/Design Specs
- **Icons:** 
  - Chat Toggle: `MessageCircle` (Lucide).
  - AI Actions: `Sparkles` (Lucide).
  - Trash/Clear: (Removed in favor of `/clear` command).
- **Theme:** Matches system theme (Dark/Light).
- **Typography:** Markdown-free or simple markdown rendering in chat bubbles. Pre-wrap enabled for whitespace preservation.

## 6. Implementation Checklist
- [ ] **Chat:** Implement `/` command auto-complete popover.
- [ ] **Chat:** Optimize context window to top 30 notes + active note.
- [ ] **Editor:** Build TipTap extension for `/` slash commands.
- [ ] **Editor:** Integrate "AI Command" into slash menu.
- [ ] **Editor:** Implement "Suggestion/Diff" view decoration.
- [ ] **Editor:** Build "Accept/Reject" tooltip component.
- [ ] **State:** Wire Yjs checkpointing to AI acceptance action.
