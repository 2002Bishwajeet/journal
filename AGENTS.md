# AGENTS.md - Journal App

## Project Overview

A premium, offline-first markdown note-taking app powered by **Homebase**. Built with React + TypeScript, React Query, shadcn/ui, TipTap editor, PGlite (WASM Postgres), Yjs CRDTs, and WebLLM.

> **Design Philosophy**: Notion/Obsidian-like — clean, minimal, professional. No gradients.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 + TypeScript 7 (typecheck; TS 6 kept for typescript-eslint) + Vite 8 |
| State/Data | PGlite live queries (`useLiveQuery`) for local data, React Query (@tanstack) for server state |
| UI | **shadcn/ui** + Tailwind CSS 4.2 + Radix UI |
| Editor | TipTap 3 (ProseMirror) + Yjs |
| Local DB | PGlite 0.5.x — Postgres 18 in a Web Worker (IndexedDB persistence, live queries, pg_trgm) |
| Backend | Homebase SDK `@homebase-id/js-lib` 0.0.7-alpha.86 (encrypted sync; from GitHub Packages) |
| AI | WebLLM — Qwen2.5-1.5B default, 4 models available |
| PWA | vite-plugin-pwa + Service Worker |
| Animations | Framer Motion |
| Testing | Vitest (integration) + Playwright (e2e) |
| Hosting | Cloudflare Pages (+ a Pages Function for `/share/*`) |

## SDK Utilities

**Always use Homebase SDK helpers** instead of writing custom utilities:

```typescript
import { getNewId, tryJsonParse, base64ToUint8Array } from '@/lib/utils';
// These re-export from @homebase-id/js-lib/helpers
```

## Project Structure

Generated from `git ls-files src functions e2e mcp`. `src/components/ui/` (shadcn primitives), barrel `index.ts` files and tests are not listed one by one.

```
src/
├── components/
│   ├── auth/                   # AuthGuard (returnUrl to /welcome), DotYouClientProvider/Context, RootRedirect
│   ├── author/                 # AuthorImage
│   ├── circles/                # CircleOption (share dialog circle picker)
│   ├── contact/                # ContactImage
│   ├── editor/
│   │   ├── hooks/              # useImageDeletionTracker
│   │   ├── nodes/              # Image (ImageNode, imageSchema, imageLayout, ImageLightbox), NoteLink, LinkPreview,
│   │   │                       # Toggle, Callout, CodeBlockNodeView (live blocks), markdownParse
│   │   ├── plugins/            # Grammar, Autocomplete, FileHandler, Emoji, NoteLink/, SlashCommands/,
│   │   │                       # SearchAndReplace, collaboration, shortcuts, extensions.ts (headless schema)
│   │   ├── shared/             # ToolbarButton, ToolbarPopover, useToolbarState
│   │   ├── table/              # TableColumnMenu, TableRowMenu
│   │   ├── AIMenu.tsx          # AI rewrite dropdown
│   │   ├── AISuggestionOverlay.tsx
│   │   ├── BubbleMenuToolbar.tsx
│   │   ├── CollaborativePopover.tsx
│   │   ├── EditorContext.tsx
│   │   ├── EditorProvider.tsx  # Y.js doc init, extension config, image ingest, 2s debounced server save
│   │   ├── EditorToolbar.tsx   # Desktop toolbar
│   │   ├── editorExtensions.ts # Full extension list: headless schema + React node views
│   │   ├── EmojiPicker.tsx
│   │   ├── FindReplaceBar.tsx
│   │   ├── LinkedMentions.tsx  # Backlinks
│   │   ├── MobileToolbar.tsx   # Touch toolbar with safe-area
│   │   ├── NoteCover.tsx       # Cover image (add, reposition, remove), plus an optional dark-mode cover
│   │   ├── NoteLinkContext.tsx
│   │   ├── PeerNoteFallback.tsx / peerNoteStatus.ts  # Collaborator-owned note states
│   │   ├── TablePicker.tsx
│   │   ├── TagInput.tsx
│   │   ├── TextAlignPicker.tsx
│   │   ├── TipTapEditor.tsx
│   │   └── TocPanel.tsx        # Table of contents
│   ├── layout/
│   │   ├── ChatBot.tsx         # Per-note AI chat sidebar (logic in useChatSession)
│   │   ├── HiddenNotesView.tsx # Trash / Archive management list
│   │   ├── NoteList.tsx        # Date-grouped notes, swipe/context menu, pull-to-refresh
│   │   ├── Sidebar.tsx         # Folders, search, settings
│   │   ├── SplashScreen.tsx    # Boot progress + DB boot-failure screen (Retry / open without legacy data)
│   │   ├── SyncStatus.tsx
│   │   └── TabBar.tsx          # Desktop multi-tab editing
│   ├── liveBlocks/             # LiveBlockFrame (sandboxed iframe), LiveBlockPreview (mermaid/svg/html/react)
│   ├── modals/
│   │   ├── ConfirmDialog.tsx
│   │   ├── CreateFolderModal.tsx
│   │   ├── ExtendPermissionDialog.tsx
│   │   ├── HistoryModal.tsx    # Version history list + restore (desktop toolbar, own notes only)
│   │   ├── KeyboardShortcutsModal.tsx
│   │   ├── MarkCollaborativeDialog.tsx
│   │   ├── SearchModal.tsx     # Cmd+K full-text + fuzzy search
│   │   ├── SettingsModal.tsx   # Re-exports components/settings/SettingsDialog
│   │   ├── ShareDialog.tsx     # Publish/unpublish, link-card preview, description, indexing
│   │   ├── SignOutConfirmDialog.tsx
│   │   └── WhatsNewDialog.tsx  # RELEASE_NOTES.md entries
│   ├── OdinImage/              # Homebase payload/thumbnail/preview image rendering, pickLoadSize
│   ├── providers/
│   │   ├── OnlineProvider.tsx
│   │   └── SyncProvider.tsx    # Sync orchestration and triggers (see Sync Architecture)
│   ├── pwa/
│   │   └── UpdatePrompt.tsx
│   ├── settings/
│   │   ├── SettingsDialog.tsx  # Tabbed dialog: left nav (md+) / top tab row (phones)
│   │   ├── sections.ts         # Section registry (order = nav order)
│   │   ├── sections/           # Account, Appearance, AI (+ AIModelList), AgentAccess, Data, Shortcuts, About
│   │   ├── SectionHeader.tsx
│   │   └── SettingsRow.tsx
│   ├── share/                  # Public share page parts: ShareHeader, ShareFooter, ShareCardPreview,
│   │                           # PublicNoteImage, CopyableCodeBlock, CalloutAwareBlockquote, LiveBlockAwarePre
│   ├── ui/                     # shadcn/radix primitives
│   └── ErrorBoundary.tsx
├── contexts/
│   └── OnlineContext.ts
├── helpers/
│   ├── colors/hostnameColors.ts
│   └── dateGrouping.ts         # Today, Yesterday, Last Week, etc.
├── hooks/
│   ├── auth/                   # useAuth, useVerifyToken, useYouAuthAuthorization (app + drive slugs), useMissingPermissions
│   ├── circles/                # useCircle, useCircles
│   ├── connections/            # useConnectionInfo, useIsConnected
│   ├── image/                  # useImage (remote payload), useLocalImage (offline copy), useTinyThumb
│   ├── links/                  # useLinkMetadata, useLinkPreviewFetch
│   ├── queries/                # usePublicNote
│   ├── securityContext/        # useSecurityContext, useHasReadAccess, useHasWriteAccess
│   ├── siteData/               # useSiteData
│   ├── useAccountSettings.ts   # Settings → Account (identity, sync, sign out)
│   ├── useAgentGrants.ts       # Settings → Agent access (load/save grants file)
│   ├── useAIPreferences.ts     # Settings → AI panel state
│   ├── useAISettings.ts        # AI feature toggles (localStorage, cross-tab sync)
│   ├── useChatSession.ts       # ChatBot state and behaviour
│   ├── useContact.ts
│   ├── useDailyNote.ts         # Behind featureFlags.dailyNotes
│   ├── useDeviceType.ts        # mobile | tablet | desktop detection
│   ├── useDocumentSubscription.ts  # BroadcastChannel listener for remote updates
│   ├── useDocumentTitle.ts     # document.title per screen
│   ├── useEditorAppearance.ts  # Editor font and column width
│   ├── useFolders.ts           # Folder CRUD
│   ├── useHasScrolled.ts
│   ├── useImportExport.ts      # Settings → Data import/export handlers
│   ├── useIntersection.ts
│   ├── useJournalWebsocket.ts  # Own-drive websocket → SyncService (700 ms batched queue)
│   ├── useKeyboardShortcuts.ts
│   ├── useLayoutUrlActions.ts  # ?action=search|new|collaborate URL params
│   ├── useLiveQuery.ts         # Shared, ref-counted PGlite live queries
│   ├── useMountedTabs.ts       # Desktop tab keep-alive policy
│   ├── useNoteActions.ts       # Open / trash / archive / delete actions for lists and dialogs
│   ├── useNoteListView.ts      # Note list for the current route (folder, tag, Shared, Trash, Archive)
│   ├── useNoteTitleMap.ts      # Live id → title map for note-link chips
│   ├── useNotes.ts             # Note list + CRUD, pin, trash/archive, publish
│   ├── useOnlineContext.ts
│   ├── usePeerNoteContent.ts   # Fetch/revalidate a collaborator-owned note body
│   ├── usePeerNoteWebsocket.ts # Peer identity websocket for an open peer note
│   ├── usePendingImage.ts      # Not-yet-uploaded image from local bytes
│   ├── usePublicAuthor.ts
│   ├── useRecentEmojis.ts
│   ├── useSaveSharedNote.ts    # /save-shared copy logic
│   ├── useSearchModal.ts       # Debounced search, keyboard nav
│   ├── useSessionPersistence.ts # Last note/folder
│   ├── useShareCardImage.ts    # 1200×630 link-card image
│   ├── useShareCardPreview.ts  # What a public link's card will show
│   ├── useSharePage.ts         # Public share page data
│   ├── useSidebarCollapse.ts
│   ├── useStorageInfo.ts       # Settings → Data storage used
│   ├── useSyncService.ts       # SyncContext consumer
│   ├── useTabManager.ts        # Multi-tab state (max 10, persisted)
│   ├── useTabRouting.ts        # Tabs kept in sync with the URL
│   ├── useTags.ts
│   ├── useTemplates.ts         # Behind featureFlags.templates
│   ├── useThemePreference.ts   # light | dark | system
│   ├── useVersionHistory.ts    # Snapshot list + restore for HistoryModal
│   ├── useWebLLM.ts            # Lazy-loaded AI engine with idle GC
│   ├── useWebsocketSubscriber.ts # Generic Homebase websocket subscription (own drive or peer)
│   └── useWhatsNew.ts
├── layouts/
│   ├── JournalLayout.tsx       # Authenticated shell: sidebar, note list, tabs/editor, dialogs
│   └── mobilePane.ts           # Which single pane mobile/tablet shows for a route
├── lib/
│   ├── agent/                  # Agent access (#164): grants.ts (resolver), editEngine.ts (markdown → minimal Yjs diff),
│   │                           # attribution.ts (agent:<client> → "Edited by …"). Shared with mcp/
│   ├── broadcast/
│   │   └── DocumentBroadcast.ts  # Singleton, BroadcastChannel API
│   ├── db/
│   │   ├── pglite.ts           # PGlite worker singleton, boot, legacy migration, retry / skip
│   │   ├── pglite-worker.ts    # Web Worker entry — runs PGlite off main thread
│   │   ├── pgliteWorkerHost.ts # Forked leader loop of PGlite's multi-tab worker
│   │   ├── pglite-migrate.ts   # 0.4 → 0.5 (Postgres 17 → 18) pg_dump migration
│   │   ├── schema.ts           # Base tables, migration chain, schema_meta revision, trigram SQL
│   │   ├── syncErrorsSchema.ts
│   │   └── queries/            # All SQL queries, one module per table (index.ts re-exports)
│   ├── e2e/testHooks.ts        # E2E-only readiness hooks (never in the production bundle)
│   ├── editor/                 # cover.ts, extractHeadings.ts, extractNoteLinkIds.ts, linkPreview.ts
│   ├── history/                # Version history (local only, never synced)
│   │   ├── snapshot.ts         # captureSnapshot — called by PGliteProvider.compact()
│   │   ├── retention.ts        # selectSnapshotsToPrune — pure retention policy
│   │   └── restore.ts          # restoreSnapshot — setContent through the editor (undoable, syncs)
│   ├── homebase/
│   │   ├── config.ts           # App IDs and slugs, drive, file/data types, payload keys
│   │   ├── AgentGrantsDriveProvider.ts # Agent grants file on JOURNAL_DRIVE
│   │   ├── FolderDriveProvider.ts
│   │   ├── NotesDriveProvider.ts
│   │   ├── noteUploadMetadata.ts   # Note ACL / appData / header-content builders
│   │   ├── noteImagePayloads.ts    # Yjs content + image payload/thumbnail builders
│   │   ├── InvitationDriveProvider.ts # Collaboration invite files
│   │   ├── InboxProcessor.ts   # Remote change processing
│   │   ├── httpStatus.ts
│   │   ├── SyncService.ts      # Pull/push orchestration
│   │   └── sync/               # context, pull, push, merge (Yjs), imageUploads, peerNotes
│   ├── images/imageIngest.ts   # Downscale to 2560px, re-orient, strip EXIF before queueing
│   ├── importexport/
│   │   ├── ExportService.ts    # .md/.zip with YAML frontmatter and assets/ images
│   │   ├── exportNoteMarkdown.ts
│   │   └── ImportService.ts
│   ├── notes/createNote.ts     # Save Yjs blob, index, queue for sync
│   ├── providers/              # ContactProvider, ContactSourceProvider, ShareProvider (guest reads)
│   ├── search/                 # searchService.ts (web search via SearXNG), findReplace.ts
│   ├── share/                  # articleMeta, cardImage, markdownPipeline, publicCard (share page + card)
│   ├── sync/                   # WebSocketProcessQueue
│   ├── utils/                  # attachmentSrc, chunkReload, hash, imageProxy, initLogging, markdownTableParser,
│   │                           # memoryMonitor, shareSanitizeSchema, sw-safety
│   ├── webllm/
│   │   ├── engine.ts           # Grammar, autocomplete, rewrite, chat
│   │   ├── models.ts           # Model registry (Qwen2.5-1.5B, SmolLM2-360M, etc.)
│   │   ├── worker.ts           # WebLLM worker
│   │   └── index.ts
│   ├── yjs/
│   │   ├── provider.ts         # PGliteProvider — Yjs persistence + auto-compaction
│   │   ├── flushPendingSave.ts # Teardown flush of the editor's debounced server save
│   │   ├── fragmentToMarkdown.ts
│   │   ├── imageRefs.ts
│   │   ├── loadDoc.ts
│   │   └── noteContent.ts
│   ├── bootProgress.ts         # Splash progress phases + boot error store
│   ├── changelog.ts            # RELEASE_NOTES.md parser for What's new
│   ├── featureFlags.ts         # Gates for shipped-but-unpolished features
│   ├── liveBlocks.ts           # Live block kinds, html frame CSP + CDN allowlist
│   ├── reactBlockCompiler.ts / reactBlockRecharts.ts / reactBlockTailwind.ts  # react live blocks
│   ├── sharePath.ts            # isPublicSharePath
│   ├── storage.ts              # Device-local UI state (localStorage)
│   ├── yjs-utils.ts            # Markdown/plain text from a Yjs doc
│   └── utils.ts                # Re-exports from Homebase SDK + UI helpers
├── pages/
│   ├── Landing.tsx             # Welcome / login screen
│   ├── AuthFinalizePage.tsx    # OAuth callback
│   ├── EditorPage.tsx          # Main editor with toolbar (EditorPage.lazy.ts wraps it)
│   ├── EmptyEditorPage.tsx     # No-note-selected state
│   ├── SaveSharedPage.tsx      # Save a copy of a shared note
│   ├── SharePage.tsx           # Public read-only note
│   └── ShareTargetPage.tsx     # PWA share target receiver
├── types/
│   └── index.ts                # All TypeScript interfaces
├── styles/
│   └── syntax.css              # Code block highlighting
├── __tests__/                  # Vitest integration/unit tests (stubs/ for virtual modules)
├── App.tsx                     # Router + Provider stack
├── main.tsx                    # Entry point
├── globals.d.ts
├── index.css                   # Tailwind + custom CSS variables
└── sw.ts                       # Service Worker
functions/                      # Cloudflare Pages Functions (limited to /share/* by public/_routes.json)
├── share/[[path]].ts           # Injects link-preview meta into the SPA shell
└── _lib/                       # shareMeta.ts (fetch + build meta, pure), types.ts
mcp/                            # Local stdio MCP server for agents (run with vite-node)
├── server.ts                   # Entry: serve, login, logout
├── createServer.ts             # Tool registration (4 read + 4 write tools)
├── tools/                      # read.ts, write.ts
├── drive.ts / client.ts        # Homebase drive access under Node
├── login.ts / credentials.ts   # App registration, OS-keychain credentials
├── config.ts                   # journal-mcp app id and slug
├── package/                    # npm package published by mcp-release.yml
└── README.md                   # Setup, tools, live-block authoring guide
e2e/                            # Playwright (see e2e/README.md)
├── <area>/*.spec.ts            # Backend-free specs (hermetic project)
├── <area>/*.live.spec.ts       # Live tier against a real Homebase
├── edge/                       # Pages headers/redirects/Function specs (wrangler pages dev)
├── live/                       # Live-tier setup, Docker identity, teardown
├── support/                    # actions, origin-guard, network-fence, make-cert, mcp-client
└── fixtures.ts
public/                         # Static assets, _headers (COEP/COOP), _redirects, _routes.json
scripts/                        # check-precache, release-notes, check-doc-paths, harness/
```

## Key Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | Router + provider stack (React Query persister, auth, sync) |
| `src/layouts/JournalLayout.tsx` | Authenticated shell: sidebar, note list, tabs/editor, dialogs |
| `src/hooks/useLiveQuery.ts` | Shared, ref-counted PGlite live queries (local reads) |
| `src/hooks/useNotes.ts` | Note list + CRUD, pin, trash/archive, publish |
| `src/hooks/useFolders.ts` | Folder CRUD |
| `src/hooks/useNoteListView.ts` | Note list for the current route |
| `src/hooks/useAISettings.ts` | AI feature toggles, model selection |
| `src/hooks/useWebLLM.ts` | Lazy-loaded WebLLM with idle GC |
| `src/hooks/useTabManager.ts` | Multi-tab editing state |
| `src/hooks/useTabRouting.ts` | Tabs kept in sync with the URL (open, click, close) |
| `src/hooks/useLayoutUrlActions.ts` | `?action=search\|new\|collaborate` URL params |
| `src/hooks/useSessionPersistence.ts` | Last note and folder |
| `src/hooks/useSyncService.ts` | Sync context consumer |
| `src/hooks/useJournalWebsocket.ts` | Own-drive websocket notifications → sync |
| `src/hooks/usePeerNoteWebsocket.ts` | Websocket to a collaborator's identity for an open peer note |
| `src/hooks/useWebsocketSubscriber.ts` | Generic Homebase websocket subscription |
| `src/components/providers/SyncProvider.tsx` | Sync state + sync triggers (mount, visibility, online, websocket, retry) |
| `src/components/editor/EditorProvider.tsx` | Y.js doc init, extensions, image ingest, debounced server save |
| `src/components/editor/editorExtensions.ts` | Full TipTap extension list (with React node views) |
| `src/components/editor/plugins/extensions.ts` | Headless TipTap schema (shared with the MCP edit engine) |
| `src/components/editor/plugins/GrammarPlugin.ts` | AI grammar with hallucination guards |
| `src/components/editor/plugins/AutocompletePlugin.ts` | Ghost text suggestions |
| `src/components/settings/sections.ts` | Settings section registry |
| `src/components/modals/SearchModal.tsx` | Cmd+K search |
| `src/components/layout/SplashScreen.tsx` | Boot progress + boot-failure screen |
| `src/lib/broadcast/DocumentBroadcast.ts` | Cross-tab messaging singleton |
| `src/lib/db/pglite.ts` | PGlite singleton, boot, legacy migration |
| `src/lib/db/pglite-migrate.ts` | Legacy (Postgres 17) dump for the 0.4 → 0.5 upgrade |
| `src/lib/db/schema.ts` | Tables, migration chain, `schema_meta` revision |
| `src/lib/db/queries/` | All SQL queries, one module per table (`@/lib/db/queries`) |
| `src/lib/homebase/config.ts` | App IDs and slugs, drive config, payload keys |
| `src/lib/homebase/SyncService.ts` | Bidirectional Homebase sync |
| `src/lib/yjs/provider.ts` | PGlite Yjs persistence + auto-compaction |
| `src/lib/yjs/flushPendingSave.ts` | Push the last edits when an editor unmounts |
| `src/lib/images/imageIngest.ts` | Image downscale / EXIF strip before upload |
| `src/lib/liveBlocks.ts` | Live block kinds and the html frame CSP |
| `src/lib/agent/grants.ts` | Agent-access grant resolver (app + MCP server) |
| `src/lib/webllm/engine.ts` | Grammar, autocomplete, rewrite, chat |
| `src/lib/webllm/models.ts` | Available model registry |
| `src/lib/importexport/` | .md/.zip export (with images) and import |
| `functions/share/[[path]].ts` | Pages Function: link-preview meta for `/share/*` |
| `mcp/server.ts` | MCP server entry (`npm run mcp`, `mcp:login`, `mcp:logout`) |
| `e2e/README.md` | E2E conventions, layers, agent loop (canonical) |

### Data pattern

- **Local reads are PGlite live queries** through `useLiveQuery` (`src/hooks/useLiveQuery.ts`): one ref-counted subscription per (sql, params), parked with its last rows when the last consumer unmounts, suspended during bulk sync writes. Note lists, folders, sidebar counts, tags and note-link titles read this way, so a write to PGlite (local edit or sync pull) re-renders them without manual cache invalidation.
- **Server state is React Query** (`src/App.tsx`): profiles, circles, contacts, connection info, images, link metadata, public notes. Persisted to IndexedDB for offline use (`staleTime` 5 min, `gcTime` and persister `maxAge` 7 days).
- **Mutations write PGlite first, then reconcile remotely.** `useNotes` mutations update the local row and mark the sync record `pending` for the next push; trash/archive call the remote right away and roll the local change back if it fails (`applyArchivalStatus` in `src/hooks/useNotes.ts`). Remote deletes are queued when sync isn't ready.
- **Editor persistence is `PGliteProvider` + `DocumentBroadcast`.** Every Yjs update is stored in `document_updates` (compacted after 50 updates, with a version-history snapshot); `DocumentBroadcast` tells other editors and tabs to reload a doc and asks every provider to flush before a sync. Content reaches the server through `EditorProvider`'s 2 s debounced save (`syncNote`), and `src/lib/yjs/flushPendingSave.ts` pushes a still-pending save when the editor unmounts.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+K | Open search modal |
| Cmd+N | Create new note |
| Cmd+S | Swallowed — the editor auto-saves (no sync) |
| Cmd+B | Bold |
| Cmd+I | Italic |
| Cmd+E | Inline code |
| Cmd+Shift+X | Strikethrough |
| Cmd+Shift+K | Add/edit link |
| Cmd+Shift+7 | Ordered list |
| Cmd+Shift+8 | Bullet list |
| Cmd+Shift+9 | Task list |
| Cmd+Z | Undo (Yjs-aware) |
| Cmd+Y / Cmd+Shift+Z | Redo (Yjs-aware) |
| Tab | Accept autocomplete suggestion |
| Escape | Dismiss autocomplete / slash commands |
| / | Open slash command menu |

## Homebase Configuration

| Constant | Dev | Prod |
|----------|-----|------|
| App ID | `38e160f1f815438a89eabc3a261e9952` | `c762ee784274473480919d8080d7a825` |
| App slug | `journal-dev` | `journal` |
| App name | `Journal (Local Dev)` | `Journal` |
| Note File Type | `605` | `605` |
| Note Data Type | `706` | `706` |
| Folder File Type | `606` | `606` |
| Folder Data Type | `707` | `707` |
| Drive Alias | `d5f411fa83fd4854a3bd7e974cc9bca9` | same |
| Drive Type | `30743710039d4b97bbd352f343d1c9df` | same |
| Drive slug / type slug | `notes` / `notes` | same |
| Agent grants file / data type | `607` / `708` | same |
| Main Folder ID | `06cf9262-4eae-4276-b0d1-8ca3cf5be6f4` | same |
| Content Payload Key | `jrnl_txt` | same |
| Image Payload Prefix | `jrnl_img` | same |

Slugs (#142) give the app and its drive permanent, readable addresses on the identity (`/apps/journal/drives/notes`). They are sent at registration in `src/hooks/auth/useYouAuthAuthorization.ts`. Homebase never renames a slug and gives it out first-come per identity, so don't change them. The contacts drive request carries `contacts` slugs, which only apply if that drive doesn't exist yet. The MCP server registers separately as `journal-mcp` (`mcp/config.ts`).

## Database Schema (PGlite — 11 Tables)

Defined in `src/lib/db/schema.ts`: base tables in `initializeSchema()`, later columns and tables in `runMigrations()`. A data dir migrated from PGlite 0.4 also has the empty marker table `pglite_legacy_migrated` (see PGlite Version Migration).

### `schema_meta` — Applied schema revision
- `id` INT PK (always 1), `version` TEXT (`SCHEMA_VERSION`)
- When it matches, boot skips all schema DDL. Bump `SCHEMA_VERSION` whenever `runMigrations()` gains a statement

### `document_updates` — Yjs source of truth
- `id` SERIAL PK, `doc_id` UUID, `update_blob` BYTEA, `created_at` TIMESTAMPTZ
- Index: `idx_document_updates_doc_id` on doc_id

### `search_index` — Derived state for FTS and list rendering
- `doc_id` UUID PK, `title` TEXT, `plain_text_content` TEXT, `metadata` JSONB, `vector_embedding` REAL[], `search_vector` tsvector, `updated_at` TIMESTAMPTZ
- Indexes: btree on title, GIN on search_vector, expression indexes on `metadata->>'folderId'` and modified time; GIN trigram on title + content is created lazily on first fuzzy search (`ensureTrigramSearch()`)

### `folders`
- `id` UUID PK, `name` TEXT, `created_at` TIMESTAMPTZ
- Main folder auto-created: `06cf9262-4eae-4276-b0d1-8ca3cf5be6f4`

### `sync_records` — Local-to-remote mapping
- `local_id` UUID PK, `entity_type` TEXT, `remote_file_id` TEXT, `version_tag` TEXT, `last_synced_at` TIMESTAMPTZ, `sync_status` TEXT, `content_hash` TEXT, `encrypted_key_header` TEXT, `author_odin_id` TEXT, `global_transit_id` TEXT, `dirty_generation` INT
- Status values: `pending`, `synced`, `error`, `conflict`

### `pending_image_uploads` — Retry queue
- `id` UUID PK, `note_doc_id` UUID, `blob_data` BYTEA, `content_type` TEXT, `status` TEXT, `retry_count` INT, `payload_key` TEXT, `next_retry_at` TIMESTAMPTZ, `created_at` TIMESTAMPTZ

### `pending_image_deletions`
- `id` SERIAL PK, `note_doc_id` UUID, `payload_key` TEXT, `created_at` TIMESTAMPTZ, UNIQUE(note_doc_id, payload_key)

### `sync_errors` — Error tracking with retry
- `id` SERIAL PK, `entity_id` UUID, `entity_type` TEXT, `operation` TEXT, `error_message` TEXT, `error_code` TEXT, `retry_count` INT, `next_retry_at` TIMESTAMPTZ, `created_at` TIMESTAMPTZ, `resolved_at` TIMESTAMPTZ

### `job_queue` — Background tasks
- `id` SERIAL PK, `job_type` TEXT, `payload` JSONB, `status` TEXT, `error_message` TEXT, `created_at` TIMESTAMPTZ, `processed_at` TIMESTAMPTZ

### `app_state` — Session persistence (key-value)
- `key` TEXT PK, `value` JSONB, `updated_at` TIMESTAMPTZ

### `document_snapshots` — Version history (this device only, never synced)
- `id` SERIAL PK, `doc_id` UUID, `state_blob` BYTEA, `state_vector` BYTEA, `preview` TEXT, `word_count` INT, `created_at` TIMESTAMPTZ
- Index: `idx_snapshots_doc_created` on (doc_id, created_at DESC)
- Written by `PGliteProvider.compact()` before the update log is replaced (skipped if the newest snapshot is under 5 min old or has the same state vector); pruned by `selectSnapshotsToPrune` (all < 24 h, one per UTC day to 30 days, one per ISO week after, max 50)

## PGlite Version Migration

PGlite runs in a **Web Worker** (`src/lib/db/pglite-worker.ts`) via `PGliteWorker` for off-main-thread DB operations. The engine version is stamped in `localStorage['journal-pglite-version']` (currently `'0.5'`; `null` = PGlite 0.3, `'0.4'` = PGlite 0.4).

**Why a logical dump:** PGlite 0.5 runs Postgres 18; 0.3 and 0.4 ran Postgres 17. Postgres refuses a data dir written by another major version, and physical data-dir copies can't cross a major. Upgrades use `pg_dump` (from `@electric-sql/pglite-tools`) against the old engine and restore the SQL into the new one.

**Data dirs:** the live engine uses `idb://journal-db-pg18` (IndexedDB `/pglite/journal-db-pg18`). The legacy Postgres 17 DB lives at `idb://journal-db` (`/pglite/journal-db`) and is only deleted after its data has been restored into the new dir.

**Migration flow** (`migrateLegacyDatabase()` in `src/lib/db/pglite.ts`, run when the stamp ≠ `PGLITE_VERSION` and the user hasn't chosen to skip; serialised across tabs by the `journal-db-migrate` Web Lock):

1. `dumpLegacyDatabase(storedVersion)` in `src/lib/db/pglite-migrate.ts`: a cheap IndexedDB existence check first (no engine is imported when there's nothing to migrate). The legacy dir is opened with the **v0.4 engine** (`pglite-v4` alias) for both stamps — 0.3 and 0.4 are both Postgres 17. A `null` (0.3) stamp opens the `template1` database, where 0.3 kept user tables; a `'0.4'` stamp opens `postgres`, and if that holds no notes, `template1` is checked too (v0.3 data the old physical migration never copied). If the v0.4 engine refuses the dir (`PGlite failed to initialize properly`), it is actually Postgres 18 and is opened with the current engine. Dumped with `PG_DUMP_ARGS` (`--clean --if-exists`). An empty legacy DB is retired and nothing is restored.
2. `restoreLegacyDump()`: one `db.transaction()` that restores the dump and creates the **marker table** `pglite_legacy_migrated`, then `RESET search_path` (pg_dump output sets it to `''` session-wide). If the marker table already exists the restore is skipped: the stamp alone can't prove the dir carries the data (an old-build tab, a rollback or two racing tabs can reset it). The worker for this launch runs with `relaxedDurability: false`, so the restore is on disk before the legacy DB is deleted; every other launch runs relaxed (`createWorkerInstance()`), where a COMMIT can return before the IndexedDB flush.
3. Stamp `PGLITE_VERSION`, `retireLegacyDatabase()` (re-checks `template1` before deleting; keeps the DB if it still holds uncopied v0.3 tables), run `initializeSchema()`. A delete blocked by this tab's own IndexedDB connection is finished by `cleanUpLegacyDatabase()` on a later launch.

**Failures fail the boot.** A dump failure throws `LegacyMigrationError`; a failed restore rolls back. Either way nothing is stamped or deleted and the app does **not** open an empty database: `getDatabase()` caches the rejection and the splash shows a boot-error screen (`BootErrorScreen` in `src/components/layout/SplashScreen.tsx`) with **Retry** (`retryDatabase()`). After a second migration failure it also offers **open without legacy data** (`bootWithoutLegacyData()`), which sets the `journal-pglite-skip-legacy` and `journal-pglite-legacy-kept` flags, keeps the legacy DB on disk and leaves the version unstamped so a later launch can still recover it.

**IMPORTANT — When bumping PGlite:**

1. `@electric-sql/pglite` and `@electric-sql/pglite-tools` must move together: pglite-tools pins an **exact** pglite peer version (pglite-tools 0.4.8 ↔ pglite 0.5.8). Don't let Dependabot bump one without the other.
2. `src/lib/db/pgliteWorkerHost.ts` is a fork of pglite 0.5.8's worker leader loop. Its drift guard (`src/__tests__/pgliteWorkerHost.test.ts`) fails on any pglite bump; re-port the listed changes onto the new upstream code.
3. If the Postgres major changes: install the outgoing engine as an alias (`npm install pglite-vN@npm:@electric-sql/pglite@0.N.x`), point `DATA_DIR` in `src/lib/db/pglite.ts` at a new dir, bump `PGLITE_VERSION`, and teach `openLegacyDatabase()` the old stamp.
4. In `vite.config.ts`, claim the alias's chunk before the `@electric-sql/pglite` rule and add its chunk plus hashed `.wasm`/`.data`/`initdb`/`pg_trgm` assets to `injectManifest.globIgnores` — by **exact** hashed name, since the live engine's files share those prefixes and must stay precached.
5. `src/__tests__/pgliteLegacyDump.test.ts` runs the real engines end to end (dump → restore); it must pass.

Current state: the `pglite-v4` alias (0.4.x) is a dependency, used only for migration. The app no longer ships a 0.3 engine (removed in `408ce3d`); a 0.3.x alias stays in devDependencies only so `src/__tests__/pgliteLegacyDump.test.ts` can write real 0.3 data dirs. Remove both (and the `vite.config.ts` rules for `pglite-v4`) once all users have migrated.

## AI Integration

### Available Models (`src/lib/webllm/models.ts`)

| Model | Size | Memory | Recommended |
|-------|------|--------|-------------|
| Qwen2.5-1.5B | ~900 MB | ~1.2 GB | Yes (default) |
| SmolLM2-360M | ~250 MB | ~400 MB | Low-end devices |
| Qwen2.5-0.5B | ~350 MB | ~500 MB | Lightweight |
| Llama-3.2-1B (Legacy) | ~700 MB | ~1.5 GB | No |

### AI Features
- **Grammar checking**: GrammarPlugin with inline wavy underlines, 3s debounce, hallucination filtering
- **Autocomplete**: Ghost text via AutocompletePlugin, 500 ms debounce, Tab to accept
- **Rewrite**: 8 styles — Proofread, Rewrite, Friendly, Professional, Concise, Summary, Key Points, List/Table
- **Chat**: Per-note AI chat sidebar (ChatBot component)
- **Slash commands**: `/ask`, `/summarize`, `/rewrite` via AI suggestion overlay
- **Idle GC**: Auto-unloads model after 5 minutes idle to reclaim ~2-3 GB memory
- **Mobile**: Disabled on mobile devices (insufficient memory)

### Settings
- Stored in `localStorage['journal-ai-settings']`
- Cross-tab sync via StorageEvent
- Toggles: enabled, autocompleteEnabled, grammarEnabled, modelId

## Development

Install and first run are in `README.md` (Node ≥ 22, and a GitHub token with `read:packages` in a project `.npmrc` for `@homebase-id/js-lib`).

```bash
npm ci
npm run dev        # HTTPS on dev.dotyou.cloud:5173
npm run build      # typecheck (tsc -b, TypeScript 7) + vite build
npm run lint
npm run test       # vitest run
npm run test:watch
npm run test:ui    # visual dashboard
npm run e2e        # Playwright, hermetic project (see e2e/README.md)
npm run mcp        # local MCP server (see mcp/README.md)
```

**Dev server**: `vite.config.ts` serves HTTPS on `dev.dotyou.cloud:5173` with the committed **Let's Encrypt** certificate `dev-dotyou-cloud.crt`/`.key`. `dev.dotyou.cloud` resolves to `127.0.0.1` in public DNS, so no hosts entry is needed. Let's Encrypt certificates last 90 days; the current one expires 2026-11-03 (`openssl x509 -in dev-dotyou-cloud.crt -noout -enddate`); renewing it means committing a new pair. Dev and preview also send `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin` (for WebLLM/SharedArrayBuffer); production gets the same from `public/_headers`.

**E2E origins** never use the dev cert or host: `vite --mode e2e` serves plain HTTP on `127.0.0.1` (`:5174` dev, `:4173` preview), the edge tier runs `wrangler pages dev` on `127.0.0.1:8788`, and the live tier uses `https://e2e.dotyou.cloud:4443` with a throwaway certificate that `e2e/support/make-cert.mjs` generates locally (into the ignored e2e/.certs directory).

## Deploy and release

- A push to `main` deploys a Cloudflare Pages **preview** (`deploy-cloudflare.yml`, `--branch=preview`), never production.
- Production changes only with a release: run **Manual Release** (`manual-release.yml`, patch/minor/major). It pushes over SSH with the `RELEASE_DEPLOY_KEY` deploy key (the main ruleset's bypass actor) and otherwise uses `github.token`: it bumps `package.json`, updates `CHANGELOG.md`, commits `chore(release): X.Y.Z [skip ci]`, pushes tag `vX.Y.Z`, creates the GitHub release, then calls `deploy-cloudflare.yml` (production branch `main`) on that tag.
- `mcp-release.yml` (`mcp-v*` releases) never deploys the app.
- **Release notes:** a PR with a change users can see adds a bullet under `## Unreleased` in `RELEASE_NOTES.md` (`### New`, `### Changed` or `### Fixed`), written in ASD-STE100 Simplified Technical English (rules at the top of that file). Users read it in the app's What's new dialog and on the GitHub release. Manual Release stamps it with the version and fails if it is empty. `CHANGELOG.md` stays the generated commit log.

## Agent harness

`/implement <epic#|issue#…>` (`.claude/commands/implement.md`) works every unblocked `agent-ready` issue unattended:

- `scripts/harness/select.mjs` picks issues: open, `agent-ready`, not `needs-design`/`blocked`, no open PR, and every issue on its `Depends on:` line closed. Epics expand recursively to their sub-issues, so `/implement 163` (the backlog tracker) covers everything.
- The `implement-epic` workflow (`.claude/workflows/implement-epic.js`) runs 2 issues at a time: an implementer in its own worktree (effort follows `Size:`), a fresh Sonnet verifier that runs the issue's `## Verification` (e2e first) and reviews the diff, 1 fix round, then a PR labelled `agent-harness` with `Closes #N` and the check table.
- `--dry` prints the selection table and starts nothing. `--loop` waits for you to merge/close an `agent-harness` PR, then selects the next wave (stops when nothing is left, or after 12 h). `--max N` caps a wave (default 3). Start it from a fresh session to keep token use down.
- A STOP condition or still-failing verification comments on the issue and adds `blocked`; remove the label to make it selectable again.
- Heavy commands go through `scripts/harness/serial.sh` (one build/test/lint/e2e at a time). The owner is the only merge gate.

## Code Conventions

- **Minimize useState**: Derive state during render when possible
- **Extract hooks**: Complex state logic goes in `src/hooks/`
- **Keep pages clean**: Pages only compose components
- **Use SDK utilities**: `getNewId()`, `tryJsonParse()`, `base64ToUint8Array()` from `@/lib/utils`
- **Lazy loading**: Dynamic imports for heavy modules (WebLLM ~7MB, ImportService, ExportService)
- **Avoid over-optimization**: No `useCallback`/`useMemo` unless profiling shows need
- **No `any` type**: Always use proper types. Use library-provided types (e.g. `CommandProps` from `@tiptap/core`), module augmentation (`declare global`/`declare module`), or generics instead of `any`. If there is genuinely no way to avoid `any`, stop and explain why to the user before proceeding.
- Every `eslint-disable*` needs `-- <reason>`; `@ts-ignore`/`@ts-nocheck` are banned; `@ts-expect-error` needs a description (tests only).

### UI Floors & Motion

Enforced minimums for all UI components. Do not go below these:

- **Font size**: `text-xs` minimum. No arbitrary `text-[9px]` or `text-[10px]`.
- **Disabled opacity**: `disabled:opacity-50` minimum. Do not use `disabled:opacity-30`.
- **Muted text opacity**: `text-muted-foreground/70` minimum when using opacity modifiers. Avoid `/50` or lower on text.
- **Animation timing**: fast = `duration-100`, normal = `duration-200`, slow = `duration-300`. Avoid non-scale values like `duration-[75ms]`, `duration-[120ms]`, `duration-[150ms]`.
- **Reduced motion**: global rule in `src/index.css` zeroes all CSS transitions/animations under `prefers-reduced-motion: reduce`. JS-driven animations should additionally check `useReducedMotion()`.

## Testing

`e2e/README.md` is the canonical description of the test layers, conventions and agent loop. This section is the short version.

### Testing policy (#196)

- **Integration first.** The default verification is an integration test: Vitest in Node (`src/__tests__/`), real PGlite + real Yjs, no server. Drive/network calls are stubbed at the app's provider boundary with per-test canned values. This carries most coverage: DB/SQL, sync bookkeeping, image queues, Yjs merging, routing/URL logic, parsers. Runs on every PR.
- **E2E only for core flows.** Playwright specs in `e2e/`. Backend-free specs (`*.spec.ts`, the `hermetic` project on `127.0.0.1`) run on every PR via `npm run e2e`. Realtime, websocket, second-device and MCP flows are live-tier specs (`*.live.spec.ts`) against a real Homebase: `npm run e2e:live` locally (hand-logged-in identity) or `npm run e2e:live:docker` (throwaway Docker identity); in CI they run nightly and on PRs labelled `e2e-live`, never as a required check. Pages headers and the share Function are covered by `e2e/edge/` (`npm run e2e:edge`). The HAR-recorded layer described in #196 was dropped (#202, superseded by the live tier).
- **No behavioural fakes of Homebase.** Never add an in-memory/stateful imitation of the drive; stub only at the provider boundary in integration tests, or use a real backend in E2E.
- Bug fixes: regression test at the lowest layer that reproduces the bug.
- Test names describe behaviour, not implementation (e.g. "should return only collaborative notes sorted by modified desc").
- `npm run test` must pass before any commit.

### Test Setup

- **Location**: `src/__tests__/` (virtual-module stubs in `src/__tests__/stubs/`)
- **Framework**: Vitest (30s timeout, files run in parallel on up to 4 workers, Node environment)
- **Naming**: `<feature>.test.ts`
- **Run**: `npm run test` (all) or `npx vitest run src/__tests__/<file>.test.ts` (single)
- **E2E**: `npm run e2e` (all hermetic specs, preview build on `127.0.0.1:4173`), `npm run e2e:dev -- <spec>` while iterating (dev server on `127.0.0.1:5174`). See `e2e/README.md`.

## Performance and Best Practices

- **Lazy Loading**: Heavy modules (WebLLM, ImportService, ExportService) use dynamic `import()`
- **Concurrent Features**: `useTransition` for non-urgent state updates
- **Suspense**: Wrap async components in `<Suspense>` boundaries
- **Debouncing**: Editor → search_index (500ms), editor → server save (2s), grammar (3s), autocomplete (500ms), search (150ms), session save (500ms)
- **Yjs Compaction**: Auto-compact after 50 updates
- **Query Caching**: React Query with IndexedDB persistence (7-day `gcTime` and `maxAge`, 5-min `staleTime`)
- **Code Splitting**: Manual Vite chunks for WebLLM, PGlite, TipTap, UI

## Sync Architecture

Bidirectional sync with Yjs CRDTs for conflict resolution:

1. **SyncProvider** (`src/components/providers/SyncProvider.tsx`) — React context. There is no periodic timer; a full sync runs:
   - on mount, once the sync service is ready (after the one-time sync-record migration);
   - when the tab becomes visible, throttled to once per 60 s;
   - when the browser comes back online;
   - when the websocket reconnects (`useJournalWebsocket`), plus per-file handling of `fileAdded`/`fileModified`/`fileDeleted` notifications in between;
   - as a retry after a failed sync (5 s backoff) or when skipped pushes/uploads become due;
   - manually: Sync now (sync status button, Settings → Account), pull-to-refresh on the note list.
   Between full syncs, an edited note is pushed on its own (`syncNote`) by the editor's 2 s debounced save (`EditorPage` → `EditorProvider` `onSave`) and by the share dialog. Cmd+S does not sync; it is only swallowed.
2. **SyncService** (`src/lib/homebase/SyncService.ts`, steps in `src/lib/homebase/sync/`) — Pull/push orchestration
3. **PGliteProvider** (`src/lib/yjs/provider.ts`) — Persists Yjs updates, auto-compaction
4. **DocumentBroadcast** (`src/lib/broadcast/DocumentBroadcast.ts`) — Cross-tab sync

### Sync Flow

```
Editor (Yjs) ←→ PGliteProvider ←→ DocumentBroadcast ←→ SyncService ←→ Homebase
                                                              ↓
                                                     InboxProcessor (pull)
                                                     NotesDriveProvider (push)
                                                     FolderDriveProvider (push)
```

### Sync Lifecycle
1. Flush all active PGliteProviders (pending edits → DB)
2. Pull remote changes via InboxProcessor
3. Merge Yjs documents for conflicts (CRDT)
4. Push local pending changes (folders sequential, notes parallel ×5)
5. Process pending image uploads (exponential backoff)
6. Update sync status in UI

### DocumentBroadcast API

```typescript
import { documentBroadcast } from '@/lib/broadcast';

documentBroadcast.notifyDocumentUpdated(docId);     // Notify editors to reload
await documentBroadcast.requestFlushAndWait();        // Flush all providers
const unsub = documentBroadcast.subscribe(handler);   // Listen for messages
```

## Routes

| Path | Component | Auth |
|------|-----------|------|
| `/` | RootRedirect | Yes |
| `/:folderId` | EmptyEditorPage | Yes |
| `/:folderId/:noteId` | EditorPage | Yes |
| `/share-target` | ShareTargetPage | Yes |
| `/save-shared?identity=&file=` | SaveSharedPage (saves a copy of a shared note; logic in `useSaveSharedNote`) | Yes |
| `/welcome` | Landing | No |
| `/auth/finalize` | AuthFinalizePage | No |
| `/share/:identity/:noteId` | SharePage | No |
| `*` | Redirect to `/` | — |

## Feature areas (landed epics)

Short maps of how each finished epic works. The e2e folder named in each is where its specs live.

### E2E platform (#196)

`e2e/README.md` is canonical: layers, conventions, scripts, the agent loop and safety rules. Playwright config is `playwright.config.ts` (hermetic, edge, quarantine) and `playwright.live.config.ts` (live tier). Tests only ever run on test origins (`127.0.0.1:4173`, `127.0.0.1:5174`, `127.0.0.1:8788`, `e2e.dotyou.cloud:4443`), never on `dev.dotyou.cloud:5173` or your real identity; `e2e/support/network-fence.ts` and `e2e/support/origin-guard.ts` enforce it. The policy is in Testing above.

### Agent access / MCP server (#164)

- `mcp/` is a local stdio MCP server (run with `vite-node`, `npm run mcp`) with its own Homebase app registration (`journal-mcp`, `mcp/config.ts`), approved once with `npm run mcp:login -- <identity>`; credentials live in the OS keychain (`mcp/credentials.ts`). It has no local DB: every call reads and writes `JOURNAL_DRIVE` directly, so the app and the server meet only at the drive, like two devices. Setup and the tool list are in `mcp/README.md`; the Claude Code plugin is in `plugins/journal/`.
- Grants: Settings → Agent access (`src/components/settings/sections/AgentAccessSection.tsx`, `src/hooks/useAgentGrants.ts`) sets each folder or note to none / read / write; default none, a note grant beats its folder's, and `excludeFromAI` notes are always hidden. Stored as one grants file on the drive (`src/lib/homebase/AgentGrantsDriveProvider.ts`, file type 607, fixed unique id) and resolved by `src/lib/agent/grants.ts`, which the server re-reads on every call.
- Edits are minimal Yjs diffs (`src/lib/agent/editEngine.ts`, `updateYFragment`), uploaded with the fetched version tag and retried on conflict, so concurrent edits merge. Agent writes set `lastEditedBy` to `agent:<client>`, shown as "Edited by …" (`src/lib/agent/attribution.ts`).
- Covers (#516): `set_note_cover` / `clear_note_cover`. The image (file path or `data:` URI) is read by `mcp/imageSource.ts` and checked by `src/lib/images/imageBytes.ts` (PNG/JPEG/WebP by magic bytes, ≤ 5 MB, metadata stripped without a canvas), then uploaded through `addImageToNote` with the image as its own thumbnail. Reuse both for body images.
- Body images (#415): in markdown passed to `create_note`, `append_to_note`, `replace_in_note` (`new_text`) and `update_note`, `![alt](<path or data: URI>)` is uploaded (`editWithBodyImages` in `mcp/tools/write.ts`) and swapped to `attachment://…` by the markdown parse (`imageSrcs` in `editEngine.ts`) before the Yjs write. All images are read and checked first, so a bad one fails the call with nothing written; `create_note` creates the note empty, then writes the body, and trashes it if that fails.
- Specs: `e2e/agent-access/` (live tier). Not done: live co-editing with agent presence (#171, needs design).

### Images pipeline (#184)

- In: drop, paste, toolbar button and `/image` all go through `FileHandler` → `src/lib/images/imageIngest.ts` (re-orient, strip EXIF, downscale to 2560 px; HEIC where the browser decodes it) → bytes queued in `pending_image_uploads`, node shows them via `usePendingImage` until upload, surviving reload and offline.
- Upload: `src/lib/homebase/sync/imageUploads.ts` patches a `jrnl_img<N>` payload (plus thumbnails) onto the note file and rewrites the src to `attachment://<fileId>/<payloadKey>`, with backoff and a retry/failed state. The bytes stay local so uploaded images render offline (`src/hooks/image/useLocalImage.ts`).
- Render: `ImageNode` (alt text, resize, float align, lightbox in `ImageLightbox.tsx`), `OdinImage` for remote payloads, scoped by `parseAttachmentSrc` (`src/lib/utils/attachmentSrc.ts`) so a pasted ref to another note's file is never followed. Collaborators and public share pages render images too.
- Delete: `useImageDeletionTracker` → `pending_image_deletions` → payload deletes on the next push. Export: ZIP with an `assets/` folder (`src/lib/importexport/ExportService.ts`).
- Specs: `e2e/images/`.

### Routing (#195)

- Routes are in `src/App.tsx` (Routes table above); the authenticated shell is `src/layouts/JournalLayout.tsx`. Unknown paths redirect to `/`.
- Sign-in keeps the requested URL: `AuthGuard` sends you to `/welcome?returnUrl=…`, the URL rides through the auth flow as `state`, and `AuthFinalizePage` returns you to it (same-origin only). URL actions (`?action=search|new|collaborate`, PWA shortcuts) are handled by `useLayoutUrlActions`, and session restore doesn't override them.
- Desktop tabs follow the URL through `useTabRouting`; missing/archived notes in tabs resolve instead of sticking on "Note not found"; `useMountedTabs` keeps visited tabs alive. Mobile shows one pane per route (`src/layouts/mobilePane.ts`), including tag filters.
- Stale lazy chunks after a deploy reload once (`src/lib/utils/chunkReload.ts`); `useDocumentTitle` sets the title per screen; `/share/*` skips app-only boot work (`src/lib/sharePath.ts`).
- Specs: `e2e/routing/`. Not done: in-app Back buttons and dialogs vs. browser Back (#192, needs design).

### Settings structure (#207)

- `src/components/settings/SettingsDialog.tsx` (opened from the sidebar footer, lazy via `src/components/modals/SettingsModal.tsx`): a tabbed dialog with the section list as a left nav from 768 px (`md`) and as a horizontally scrolling tab row above the content below that. Sections are registered in `src/components/settings/sections.ts` (order = nav order): Account, Appearance, AI, Agent access, Data & storage, Keyboard shortcuts (desktop only), About. Each section is one file in `src/components/settings/sections/`, with logic in hooks (`useAccountSettings`, `useAIPreferences`, `useAgentGrants`, `useImportExport`, `useStorageInfo`, …).
- No framer-motion in Settings; section switches are instant. Controls use `SettingsRow` with real labels.
- Specs: `e2e/settings/`.

### Share pages (#223)

- Publishing (`makeNotePublic` in `src/lib/homebase/NotesDriveProvider.ts`) re-uploads the note unencrypted with an Anonymous ACL and a small public header that carries a `card` (`description`, `coverKey`, `cardImageKey`, `indexable`; `src/lib/share/publicCard.ts`). The share dialog previews the link card and edits the description and search-engine indexing.
- The page: `/share/:identity/:noteId` → `src/pages/SharePage.tsx` reads the note with the SDK guest client (`src/lib/providers/ShareProvider.ts`) and renders it as an article: cover (the dark-mode cover in dark mode, read from the Yjs payload), byline, dates, reading time, highlighted code, live blocks (`src/components/share/`, `src/lib/share/`).
- Link previews: the Pages Function `functions/share/[[path]].ts`, limited to `/share/*` by `public/_routes.json`, fetches the SPA shell through `env.ASSETS` (so `public/_headers` still applies), validates the identity and note id, reads the public header and profile (`functions/_lib/shareMeta.ts`, short timeouts, no redirects) and injects `<title>`, `og:*`, `twitter:*`, `robots` and JSON-LD. Meta is cached 5 min (60 s for misses); any failure serves the plain shell.
- Author index (#515): the same Function renders `/share/<identity>` (HTML, no client JS) and `/share/<identity>/sitemap.xml` from a guest `drive/query/batch` of the journal drive (`functions/_lib/authorIndex.ts`): only unencrypted, non-trashed notes whose `card.indexable` is true, newest first, up to 500. Cached like share meta; any failure is a 404, not the shell. The share header's "More notes" links there.
- Specs: `e2e/publishing/` and `e2e/edge/` (`npm run e2e:edge`, `wrangler pages dev` on `127.0.0.1:8788`).

## Metadata Schema (JSONB in search_index)

```json
{
  "title": "string",
  "folderId": "UUID",
  "tags": ["string"],
  "timestamps": { "created": "ISO8601", "modified": "ISO8601" },
  "excludeFromAI": "boolean",
  "isPinned": "boolean",
  "isCollaborative": "boolean",
  "circleIds": ["UUID"],
  "recipients": ["OdinId"],
  "lastEditedBy": "OdinId"
}
```
