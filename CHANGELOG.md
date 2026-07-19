# [2.0.0](https://github.com/2002Bishwajeet/journal/compare/v1.1.8...v2.0.0) (2026-07-19)


### Bug Fixes

* **broadcast:** acknowledge same-tab flush instead of a blind 50ms sleep ([5adefe2](https://github.com/2002Bishwajeet/journal/commit/5adefe24d46859988d0af03f97ed608c6b713d72))
* **db:** atomic replaceDocumentUpdates for compaction/merge ([0a27ca3](https://github.com/2002Bishwajeet/journal/commit/0a27ca367a1a1ec142331ec8ce3d699f0c5fbee1))
* **deps:** clear npm audit advisories (lockfile refresh) ([d860bca](https://github.com/2002Bishwajeet/journal/commit/d860bcaf49bba6f7edf291e229fec917e83456ed))
* **editor:** address code-review findings on internal note links ([0bca303](https://github.com/2002Bishwajeet/journal/commit/0bca303f16235d92ece8edae0ad4513d252e92b2))
* **editor:** flush pending save on unmount so trailing edits reach the server ([2e03db3](https://github.com/2002Bishwajeet/journal/commit/2e03db362744ddc9f193c3972a7882830eec3d61))
* **editor:** give slash-commands and note-link suggestions unique plugin keys ([ad13516](https://github.com/2002Bishwajeet/journal/commit/ad13516aac7f979ff55289fa1fd7ac68ae74dd58))
* **editor:** save on first edit; skip only Yjs-origin transactions ([3039d32](https://github.com/2002Bishwajeet/journal/commit/3039d328acaaad81f288d8c07d8deabb4a318726))
* **images:** use the matched server thumbnail size ([f132b4e](https://github.com/2002Bishwajeet/journal/commit/f132b4e7074ff8b0d5111d5b6ef1adea12dd3ff7))
* **notes:** build real heading/paragraph blocks for created notes; copy template Yjs docs on spawn ([e39d598](https://github.com/2002Bishwajeet/journal/commit/e39d598145d987f525812ebecb89bf21ebc425aa))
* **notes:** derive image payload key from max index, not count ([3471cf8](https://github.com/2002Bishwajeet/journal/commit/3471cf875ba31ab23b2b908210ba4137aea6554f))
* **notes:** guard peer note update against missing globalTransitId ([43ddab4](https://github.com/2002Bishwajeet/journal/commit/43ddab4f20c952f24445a7e173eae7aa01b8e408))
* **notes:** honor encrypt option (?? not ||) and isPublic ACL in createNote ([247114b](https://github.com/2002Bishwajeet/journal/commit/247114b32891aabeb5bb8eefd3a4799e171e0488))
* **notes:** preserve encryption/ACL when adding images to public or shared notes ([2a827cf](https://github.com/2002Bishwajeet/journal/commit/2a827cfd79f3058ad5bd6c2ee6ecdace2f14fe85))
* **notes:** stop [[ picker flashing "No notes found" while searching ([78b33c3](https://github.com/2002Bishwajeet/journal/commit/78b33c36872f3549ca30cd03ed973b72256e57ca))
* **search:** advancedSearch always errored and fell back to LIKE ([a0608eb](https://github.com/2002Bishwajeet/journal/commit/a0608eb65b288c52d33ca5075ab732d33e419fb0))
* **security:** project public note content to a minimal, non-sensitive subset ([fbae37d](https://github.com/2002Bishwajeet/journal/commit/fbae37db1b0fbfdca113fcb4bb75a5f0476ebd8f))
* **security:** scope SW api-cache to same-origin and drop opaque responses ([7bab181](https://github.com/2002Bishwajeet/journal/commit/7bab181be09f79d3e4c0ac24b8a4ed21b2d2e6df))
* **security:** validate the /auth/finalize redirect target ([4f3f9ef](https://github.com/2002Bishwajeet/journal/commit/4f3f9ef3197ddb3b678497024903455f242ff5ae))
* **security:** wipe local data on every logout, not just manual logout ([33941c6](https://github.com/2002Bishwajeet/journal/commit/33941c69be4c9ad2a609ea25cf7ca3d00d010bf4))
* **sync:** flush the active editor before reading a note's push blob ([f763c13](https://github.com/2002Bishwajeet/journal/commit/f763c13cdd4243dcc50197c4bf79b90ab4e3e5a1))
* **sync:** generation guard so a slow push can't clobber a pending edit ([2478641](https://github.com/2002Bishwajeet/journal/commit/24786417ce91c63d51a411df52347cd960ce768a))
* **sync:** hash all pushed metadata fields so pin/share changes sync ([ab60b02](https://github.com/2002Bishwajeet/journal/commit/ab60b021d898c45c547e0d28e4f2a783bd60dcee))
* **sync:** never replace real Yjs content with an empty doc ([a0fe257](https://github.com/2002Bishwajeet/journal/commit/a0fe257ac76663dd7fefb53614a39dad94101f80))
* **yjs:** drain updates queued during an in-flight save ([51ed17f](https://github.com/2002Bishwajeet/journal/commit/51ed17f303ee309d71a66d46e602ba565caa3296))


### Features

* **editor:** add a table-of-contents side panel ([950c188](https://github.com/2002Bishwajeet/journal/commit/950c1887106e4e62bd7237018ccf3033cfba149f))
* **editor:** add H4–H6 heading buttons to the toolbar ([2a1f7cc](https://github.com/2002Bishwajeet/journal/commit/2a1f7cc65a0663e2bb3e8a98d18424e8819e976b))
* **editor:** add heading extraction and reading-time helpers ([47a13e5](https://github.com/2002Bishwajeet/journal/commit/47a13e5959bb1498887cf0637316b52dde09a5df))
* **editor:** internal note links [[ + backlinks ([16afb52](https://github.com/2002Bishwajeet/journal/commit/16afb52c9d06be7fc1594948d98acbf5a9a0d6d1))
* **editor:** show reading time beside the word count ([c860131](https://github.com/2002Bishwajeet/journal/commit/c86013156998e9847270ebed85f04c74e85e0434))
* **flags:** gate daily notes and templates UI behind boolean feature flags ([1de71a5](https://github.com/2002Bishwajeet/journal/commit/1de71a569d2fdef8c3a24ca60092a00e4d61b062))
* **notes:** daily note — find-or-create today's note ([89d7c41](https://github.com/2002Bishwajeet/journal/commit/89d7c4106d6c8bf97548d7a330d98a716d4d6e3e))
* **notes:** full search + frequent notes in the [[ link picker ([30c9328](https://github.com/2002Bishwajeet/journal/commit/30c9328c1e7752b0e1b70f060cad1eda5efd0853))
* **notes:** note templates from a Templates folder ([aea0425](https://github.com/2002Bishwajeet/journal/commit/aea04256ac296e2bdd8d2ea917a7a2eeea53dec9))


### Performance Improvements

* **ai:** stop polling engine readiness once ready or disabled ([0172de0](https://github.com/2002Bishwajeet/journal/commit/0172de055f94f5070965c80a05ac51979fcc5f94))
* **db:** load PGlite v3 only when a v3 database actually exists ([80ebce4](https://github.com/2002Bishwajeet/journal/commit/80ebce4ec471b4cd1d9aa86ac880d3c4430ff882))
* **db:** park idle live queries; coalesce emissions ([2c31e46](https://github.com/2002Bishwajeet/journal/commit/2c31e46bcde91a1fecee121350bc91b91dd68278))
* **editor:** compute plain text once per debounce window, not per keystroke ([6c68140](https://github.com/2002Bishwajeet/journal/commit/6c68140cb043bfe055abea44e96c6671f2e07d5a))
* **notes:** fast dedicated query for [[ picker instead of advancedSearch ([fe3c387](https://github.com/2002Bishwajeet/journal/commit/fe3c38733fcec18393cf1f39a039c64bb145682d))
* **notes:** index modified-timestamp sort + debounce [[ picker queries ([662ca21](https://github.com/2002Bishwajeet/journal/commit/662ca21c49899a86eafe10e18e8425135f28c9bb))
* **notes:** stable note-list row identity so memo holds ([c9df839](https://github.com/2002Bishwajeet/journal/commit/c9df839ae7c3d70a6b91aaa4e45cd993273af0db))
* **pwa:** stop precaching WebLLM runtime; cache on first use ([26cfa2d](https://github.com/2002Bishwajeet/journal/commit/26cfa2de9cafe8fdb4747a47ddc7bf8e546abab7))
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
