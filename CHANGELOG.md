## [1.1.7](https://github.com/2002Bishwajeet/journal/compare/v1.1.6...v1.1.7) (2026-06-04)


### Bug Fixes

* address Vercel best practices review on find/replace ([8dc1c66](https://github.com/2002Bishwajeet/journal/commit/8dc1c6614bb2bf36c468206d7740f04d3e2a3b9f))
* **deploy:** serve built dist/ on Cloudflare and restore COEP/COOP ([2b6a302](https://github.com/2002Bishwajeet/journal/commit/2b6a302538485f6f379ef397a049c36a280e8557))
* **lint:** resolve eslint errors in peer-note fetch UI ([421109e](https://github.com/2002Bishwajeet/journal/commit/421109e37411063ec8ee3ea55dd143b924fc49ee))
* **test:** correct lifecycle transition in bootstrap test ([51fbd73](https://github.com/2002Bishwajeet/journal/commit/51fbd73a12eb24a6462d3841aa12af989af875e9))
* **types:** resolve tsc -b build errors in collaboration WS code ([5426e76](https://github.com/2002Bishwajeet/journal/commit/5426e76e0ca78359c62b8f03dedbd61f768b7f2c))


### Features

* add in-editor find and replace (Cmd+F / Cmd+H) ([753e3f8](https://github.com/2002Bishwajeet/journal/commit/753e3f8a84320abe203af9b99f2e350c9787c759))
* bootstrap collaborative note with sync record on invitation ([862fd3c](https://github.com/2002Bishwajeet/journal/commit/862fd3c277fa4c25cd1ef57133440b8b4200a0c6))
* collaboration feature — sync fixes, UI, distribution, peer websocket ([8eb8205](https://github.com/2002Bishwajeet/journal/commit/8eb8205cb814fa42f18931be5294b47cc4e1c02e))
* local-first peer-note fetch with revalidate-on-open ([70d4415](https://github.com/2002Bishwajeet/journal/commit/70d4415c0149e59d086ade8f2def3a237740ca0a))
* stamp lastEditedBy on collaborative edits and add peer fetch debug logging ([d3d1022](https://github.com/2002Bishwajeet/journal/commit/d3d10226e363d739f5b8b8370ae0b8015337be41))
* websocket process queue ([2ec2c8a](https://github.com/2002Bishwajeet/journal/commit/2ec2c8a76b22eceeaa5b237b8326c2644b7b33b6))


### Performance Improvements

* parallelize peer fetches and fix excludeFromAI type safety ([4e10b62](https://github.com/2002Bishwajeet/journal/commit/4e10b622cd0d7c2b78b1682a13cdff35bc1c3834))
# Changelog

All notable changes to Journal will be documented in this file.

## [1.1.0] - 2026-04-19

### Features

#### Editor
- **Underline** formatting with Cmd+U
- **Subscript** (Cmd+,) and **Superscript** (Cmd+.) support
- **Text alignment** — left, center, right, justify with keyboard shortcuts (Cmd+Shift+L/E/R/J)
- **Clear formatting** button and Cmd+\ shortcut on all toolbars and bubble menu
- **Duplicate block** via Cmd+Shift+D and slash command
- **Indent / outdent** paragraphs and headings with Tab/Shift+Tab
- **H4, H5, H6** headings in slash commands
- **Word count** and character count status bar at editor bottom
- **Table button** on mobile toolbar

#### Tags
- **Tag input** below note title — type `#` or comma-separated tags with autocomplete from existing tags
- **Tag chips** on note list items (up to 3 with overflow count)
- **Tag filter** in sidebar — click a tag to filter notes across all folders
- **Cross-folder filtering** via `?tag=` query parameter
- Tags sync automatically to Homebase via existing metadata pipeline

#### Navigation & UX
- **Keyboard shortcuts help modal** (Cmd+/) — lists all shortcuts in categorized two-column layout
- **Focus / zen mode** (Cmd+Shift+F) — hides sidebar, note list, and tab bar for distraction-free writing with centered narrow content
- **Note sorting** — sort by last modified, date created, or title A-Z via dropdown in note list header
- **Focus mode toggle button** in tab bar for discoverability

#### AI & Models
- **AI settings hook** with localStorage persistence and cross-tab sync
- **Model registry** — Qwen 2.5 1.5B (default), SmolLM2 360M, Qwen 2.5 0.5B, Llama 3.2 1B
- **Model selection** UI in Settings > AI & Models tab with download size and memory indicators
- **Grammar plugin** re-enabled with hallucination filtering guards
- **Settings modal redesign** — tabbed layout with General, AI & Models, Data & Security, About sections

### Performance
- **WebLLM moved to Web Worker** — zero main-thread blocking for AI inference
- **Note list virtualization** with @tanstack/react-virtual
- **Lightweight NoteListEntry** queries — only title + 150-char preview, no full content transfer
- **GIN/BTREE indexes** on metadata JSONB for faster folder and tag filtering
- **React Compiler** enabled in production builds for automatic memoization
- **NoteItem memoization** to prevent unnecessary re-renders
- **Debounced word count** updates (500ms) with proper cleanup

### Bug Fixes
- Fix settings and checklist save error
- Fix tab notes persisting across sessions
- Fix metadata mutations truncating note content
- Fix ChatBot accessing truncated content instead of full note
- Fix ResizeObserver infinite loop in virtualized list
- Fix WebLLM auto-init freezing UI on load
- Fix React Compiler causing dev server freeze (production-only)
- Fix Switch toggle invisible in light mode (bg-input → bg-zinc-300)
- Fix Settings modal scrollbar causing layout shift
- Fix duplicate Underline extension warning (StarterKit 3.x bundles it)
- Fix tags not appearing in sidebar after sync (missing query invalidation)
- Fix date grouping using wrong timestamp when sorting by creation date
- Fix null preview in tag-filtered note queries
- Fix word count setState after unmount (explicit timeout ref with cleanup)
- Fix EditorProvider initial-load guard preventing false metadata timestamp bumps
- Fix deprecated navigator.platform usage
- Fix AITabProps type mismatch for async return types
- Fix unused imports and lint errors across codebase

### Refactoring
- Consolidate 3 duplicate ToolbarButton components into shared variant system (desktop/mobile/bubble)
- Extract shared Kbd component to `ui/kbd.tsx`, used in KeyboardShortcutsModal and SearchModal
- Extract DuplicateBlock into proper TipTap command, reuse in slash menu
- Use semantic design tokens in TextAlignPicker instead of hardcoded colors
- Tag filtering uses URL query params instead of React state

### Tests
- AI settings and model registry tests (12)
- Editor extensions registration tests (14)
- Slash commands and filterCommands tests (11)
- Keyboard shortcuts tests (9)
- Tag query tests (4)
- **Total: 151 tests passing**

## [1.0.6] - 2026-04-15

Initial tracked release.
