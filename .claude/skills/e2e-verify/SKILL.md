---
name: e2e-verify
description: Use when implementing or verifying a Journal issue: run/add Playwright e2e specs and attach evidence
---

# E2E verify

Read `e2e/README.md` first — it is the canonical reference for layers, conventions, fixtures, helpers, and safety rules. This skill is only the loop for running it as an agent; don't duplicate the README's tables here, and re-read the README if anything below seems stale.

## Loop

1. Iterate: `npm run e2e:dev -- <spec>` (Vite dev server on `:5174`, HMR, server reused across runs).
2. Before opening a PR: `npm run e2e -- <spec>` (preview build on `:4173` — the real built bundle, same as CI).
3. Once, right before opening the PR: the full `npm run e2e` (no spec filter).
4. Never run e2e concurrently with `npm run build`, `npm run test`, or `npm run lint` — they compete for RAM on the same machine. If `~/.claude/bin/heavy` exists in your environment, wrap each of those commands with it, e.g. `~/.claude/bin/heavy npm run e2e`; it's a per-machine lock for hosts running several agents in parallel, and a harmless no-op to skip if the script isn't there (CI, other developers' machines).

## Adding a spec

Follow the "Adding a spec" section of `e2e/README.md`: file path and area, import `test`/`expect` from `../fixtures`, use the `app`/`anonPage` fixtures and `e2e/support/actions.ts` helpers, prefer role/label/text selectors, no sleeps, `@quarantine` for flakes you can't fix yet.

## Evidence

Before marking an issue verified, paste the `list` reporter output, attach `playwright-report/` screenshots of the key assertion step, and link a trace for any failure you had to fix — see "Evidence for a PR" in `e2e/README.md`.

## Safety

Test origins only (`127.0.0.1:4173`/`5174`, never `dev.dotyou.cloud:5173` or a real Homebase), never a tool attached to a real browser profile, `assertTestOrigin(page)` before any mutating `page.evaluate()` or storage write. Full detail in the README's "Safety rules" section.
