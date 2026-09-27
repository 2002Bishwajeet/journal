# E2E Testing

Playwright drives the app hermetically on `127.0.0.1` — never `dev.dotyou.cloud:5173` or a real Homebase. Read this file before running or adding a spec; nothing else documents the e2e layer.

## Layers — use the cheapest one that would catch the bug

| Layer | What | Runs | Covers |
|---|---|---|---|
| **1. Integration** (default) | Vitest in Node (`src/__tests__/`), real PGlite + real Yjs, no server. Drive/network calls stubbed at the app's provider boundary with per-test canned values — never a stateful imitation of the drive. | every PR (`npm run test`) | DB/SQL, sync bookkeeping, image queues, Yjs merging, routing/URL logic, parsers. Most coverage lives here. |
| **2. E2E smoke, recorded** | Playwright. Backend traffic replayed from committed HAR recordings of a real Homebase identity (`*.recorded.spec.ts`), plus the backend-free local-first specs in this dir (`*.spec.ts`). | every PR (`E2E` workflow) | Core flows: session restore, create, edit, add image, share, open `/share` link; persist, two tabs, deep links, SW update. |
| **3. E2E live** | Same style (`*.live.spec.ts`), against a real Homebase, replay off. | nightly / on demand, never PR-blocking | Login, cross-device sync, websocket/realtime, MCP edits reaching the app. |

Name the integration test(s) first in every issue's Verification. Add an E2E spec only if the change alters a core flow (extend the layer-2 spec, re-record) or needs realtime / a second device (layer 3). Bug fixes: regression test at the lowest layer that reproduces the bug.

## Conventions

| Thing | Value |
|---|---|
| Config | `playwright.config.ts` (repo root); TS config `e2e/tsconfig.json` |
| Projects | `hermetic` (backend-free, `127.0.0.1`) · `recorded` (HAR replay) · `live` / `live-setup` (real Homebase) · `edge` (Pages) · `quarantine` |
| Specs | `e2e/<area>/<feature>.spec.ts` (backend-free) · `e2e/<area>/<feature>.recorded.spec.ts` (layer 2) · `e2e/<area>/<feature>.live.spec.ts` (layer 3) · `e2e/edge/<feature>.spec.ts` — area ∈ `boot, editor, sync, images, links, routing, publishing, pwa, agent-access, folders` |
| Recordings | `e2e/har/<area>/<spec-basename>.har` + `e2e/har/meta.json` + `e2e/har/replay-auth.json`; how-to in `e2e/har/README.md` |
| Imports in specs | `import { test, expect } from '../fixtures';` — never from `@playwright/test` directly |
| Fixtures | `app` (signed-in page, booted), `anonPage` (signed-out), `liveRun` (run-scoped folder on a real identity) |
| Helpers | `e2e/support/actions.ts`: `createNote`, `openNote`, `typeInEditor`, `waitForSyncIdle`; `e2e/support/origin-guard.ts`: `assertTestOrigin` |
| Scripts | `npm run e2e` (backend-free) · `npm run e2e:dev` · `npm run e2e:quarantine` (`@quarantine` specs, informational) · `npm run e2e:recorded` (HAR check + replay) · `npm run e2e:record` (re-record from a real identity) · `npm run e2e:login` · `npm run e2e:live` · `npm run e2e:edge` · `npm run e2e:report` |
| One spec / one test | `npm run e2e -- e2e/editor/persist.spec.ts -g "survives reload"` |
| Debug | `npm run e2e:dev -- <spec> --headed` · `--ui` · `--trace on` |
| Evidence | `playwright-report/` + `test-results/` (gitignored); attach the report summary and failing-step screenshots/traces to the PR |
| Selectors | `getByRole`/`getByLabel`/`getByText` first; `data-testid` only where no accessible name exists |
| Flaky | tag the title `@quarantine` + open a bug; never add sleeps |
| Build output | `vite build --mode e2e --outDir dist-e2e` (never touches `dist/`) |

This is the full epic contract (#196) — other issues rely on these names, so don't rename them here. Only some of it is built today: `hermetic`, `quarantine`, `live` and `live-setup` are the only projects (no `recorded`/`edge` yet), and `npm run e2e`, `npm run e2e:dev`, `npm run e2e:quarantine`, `npm run e2e:live`, `npm run e2e:login`, `npm run e2e:report` exist in `package.json`. The rest (`recorded`/`edge` projects, HAR recordings, `waitForSyncIdle`, and the other scripts) land with their own issues (#202, #205) — check `package.json` and this directory's contents before assuming a script or helper exists.

## CI

The `E2E` GitHub Actions check (`.github/workflows/e2e.yml`) runs the `hermetic` project (the same `npm run e2e`) on every push/PR to `main`, with 2 retries. It also runs `npm run e2e:quarantine` as a following, `continue-on-error` step — its result is informational only and never blocks the check.

On failure, the job uploads `playwright-report/` and `test-results/` (traces, screenshots, videos) as an artifact named `playwright-report-<run attempt>`, kept for 14 days. Download it from the failed run's Summary page (Artifacts section), unzip, then open `index.html` for the report or run `npx playwright show-trace <trace.zip>` for a specific trace.

## Agent loop

1. Iterate: `npm run e2e:dev -- <spec>` (Vite dev server on `:5174`, HMR, server reused across runs).
2. Before a PR: `npm run e2e -- <spec>` (preview build on `:4173` — the real built bundle, same as CI). Note: the `hermetic` project blocks service workers in both modes today, for safety (an SW fetch could bypass the network fence) — see the comment in `playwright.config.ts`.
3. Once, right before opening the PR: the full `npm run e2e` (no spec filter).
4. Never run e2e concurrently with `npm run build`, `npm run test`, or `npm run lint` — they compete for RAM on the same machine. If `~/.claude/bin/heavy` exists in your environment, wrap each of those commands with it, e.g. `~/.claude/bin/heavy npm run e2e`; it's a per-machine lock for hosts running several agents in parallel, and a harmless no-op to skip if the script isn't there (CI, other developers' machines).

## Adding a spec

- Path: `e2e/<area>/<feature>.spec.ts`, area from the Conventions table above.
- Import `test`/`expect` from `../fixtures`, never from `@playwright/test` directly.
- Use the `app` or `anonPage` fixture; call helpers from `e2e/support/actions.ts` instead of re-deriving selectors.
- Selectors: `getByRole`/`getByLabel`/`getByText` first; `data-testid` only when there's no accessible name.
- No `page.waitForTimeout` sleeps for synchronization — wait on an assertion, a fixture, or `waitForAppReady`. (A couple of existing helpers use a short, commented settle wait around a Yjs/PGlite timing gap with no DOM-observable signal — that's a documented exception, not a pattern to copy.)
- Flaky for a reason you can't fix now: tag the title `@quarantine` and open a bug — never paper over it with a sleep.

## Evidence for a PR

Paste the `list` reporter output, attach `playwright-report/` screenshots of the key assertion step, and link a trace for any failure you had to fix.

## Safety rules

- Test origins only: `http://127.0.0.1:4173`, `http://127.0.0.1:5174` (dev), and `https://e2e.dotyou.cloud:4443` (layer 3, live — see below). Never `dev.dotyou.cloud:5173` or a real Homebase from this suite.
- Never drive this app with a tool attached to a real browser profile. Use Playwright's own fresh `BrowserContext` per test, or the isolated, origin-locked Playwright MCP session below — nothing else.
- Call `assertTestOrigin(page)` before any mutating `page.evaluate()` or storage write. The `context` fixture already installs a network fence (`e2e/support/network-fence.ts`) that fails a test on any request outside the allowlist.

## Exploring interactively (Playwright MCP)

`.mcp.json` at the repo root registers a `playwright` MCP server, `--isolated` and locked to the two hermetic test origins via `--allowed-origins` — it cannot navigate anywhere else. Start the dev server first, then explore:

```bash
npx vite --mode e2e --host 127.0.0.1 --port 5174   # leave running
claude mcp list                                     # confirms "playwright" is registered
```

Then drive it with the MCP browser tools, e.g. `browser_navigate` to `http://127.0.0.1:5174`; navigating to any other origin is blocked. Don't add Chrome DevTools MCP to `.mcp.json` — it's debug-only, opt-in per session, and needs its own `--isolated`/throwaway `--user-data-dir`, never shared config.

## Issue-writing rule

Every issue's Verification section names its integration test(s) first. Name an E2E spec only if the change alters a core flow (extend the matching `*.recorded.spec.ts` and re-record) or needs realtime / a second device (`*.live.spec.ts`).

## Smoke tests (`npm run e2e`)

- `boot/origin-guard.spec.ts` — refuses to run on a non-allowlisted origin.
- `boot/welcome.spec.ts` — signed-out root redirects to `/welcome`.
- `boot/session-restore.spec.ts` — signed-in shell renders and survives a reload.
- `editor/persist.spec.ts` — a created/edited note survives a reload.
- `editor/two-tabs.spec.ts` — typing in one tab shows up in another tab on the same note.
- `routing/deep-links.spec.ts` — direct note links, back/forward, unknown routes.
- `pwa/update-prompt.spec.ts` — a changed service worker surfaces the update prompt (preview build only, skipped under `E2E_SERVER=dev`; currently `@quarantine`, see #199's STOP comment on Chromium not exposing the SW update fetch to `context.route`).

## Layer 3 — live

Runs the three `*.live.spec.ts` specs (config: `playwright.live.config.ts`, so `npm run e2e` never starts its HTTPS server or setup/teardown) against a real Homebase identity of your choice, on `https://e2e.dotyou.cloud:4443` (a self-signed cert for that host is generated on demand by `e2e/support/make-cert.mjs` into `e2e/.certs/`, gitignored). Local only — never a PR check.

1. **Log in once** (headed, interactive — you approve the app's access request yourself):

   ```bash
   E2E_LIVE_IDENTITY=<identity> npm run e2e:login
   ```

   Use a throwaway identity — a local odin-core dev identity (e.g. `frodo.dotyou.cloud`, `sam.dotyou.cloud`, ...) or a hosted test identity — **never your real journal**. This opens `/welcome`, enters the identity, and waits up to 5 minutes for you to approve on the identity's own owner console. On success it writes `e2e/.auth/live.json` (gitignored — `git status` should stay clean).

2. **Run the suite:**

   ```bash
   npm run e2e:live
   ```

   Runs serially (`workers: 1`, `retries: 1`). Each run creates its own `e2e-<ISO date>-<random>-w<worker>` folder through the UI and every spec creates notes only inside it; `e2e/live/global-teardown.ts` deletes that folder afterward and, as a safety sweep, any leftover `e2e-*` folder older than 24h (e.g. from a run that crashed before its own cleanup).

3. **Re-running later:** `e2e/.auth/live.json` is reused until the identity revokes the app or the token expires — re-run step 1 if `npm run e2e:live` starts failing to sign in.

**CI (Docker, #203):** `.github/workflows/e2e-live-docker.yml` ("E2E live") boots the published `ghcr.io/homebase-id/odin-core` image (pinned by digest) with a per-run throwaway CA and a freshly seeded dev identity — `e2e/live/ci-bootstrap.ts` is the non-interactive counterpart to `auth.setup.ts` above, clicking through owner first-run/setup/YouAuth consent with no human. No real certs or secrets beyond `GH_TOKEN` (npm registry, same as `tests.yml`). Runs nightly (02:30 UTC), on `workflow_dispatch`, and on a PR labelled `e2e-live` — never a required check. Trigger it: `gh workflow run e2e-live-docker.yml` (add `--ref <branch>` once the file exists on that branch's target). On failure it uploads `playwright-report/`, `test-results/` and the identity-host's container log as artifact `e2e-live-<run attempt>` (14-day retention, on the run's Summary page). Bump the pinned image digest deliberately — with its own green run — when the odin-core backend changes.

**Hosted-identity fallback:** `.github/workflows/e2e-live-hosted.yml` runs this same suite nightly (03:00 UTC) and on `workflow_dispatch`, against a hosted identity — but stays dormant (prints a notice, exits 0) until the `E2E_LIVE_STORAGE_STATE` secret (a base64'd `live.json`) and the `E2E_LIVE_IDENTITY` repository variable are both set. Not a PR check.
