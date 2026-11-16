---
name: e2e-verify
description: Use when implementing or verifying a Journal issue: add Playwright e2e specs; CI runs them and posts the screenshots
---

# E2E verify

Read `e2e/README.md` first — it is the canonical reference for layers, conventions, fixtures, helpers, and safety rules. This skill is only the loop for running it as an agent; don't duplicate the README's tables here, and re-read the README if anything below seems stale.

## Loop

Agents never run e2e or Playwright locally, nor anything else that starts a browser (#1324): on the 16 GB machine, Chromium, Firefox and the Node workers starved everything else. Developers can still run e2e by hand.

1. Write or update the specs your change needs, and have them take the screenshots the issue asks for (see Evidence).
2. Check they load: `npx playwright test --list <spec>` starts no browser.
3. Run lint, `npm run build` and the unit tests for the changed files (`vitest related`) — never the full suites, and never two at once. If `~/.claude/bin/heavy` exists in your environment, wrap each with it; it's a per-machine lock for hosts running several agents in parallel, and a harmless no-op to skip if the script isn't there.
4. Push, open the PR and exit; never wait for CI. CI runs every e2e spec, and the orchestrating session watches CI and merges. To fix a CI e2e failure, read the CI log and the `playwright-report-*` artifact (`gh run download`), not a local run.

## Adding a spec

Follow the "Adding a spec" section of `e2e/README.md`: file path and area, import `test`/`expect` from `../fixtures`, use the `app`/`anonPage` fixtures and `e2e/support/actions.ts` helpers, prefer role/label/text selectors, no sleeps, `@quarantine` for flakes you can't fix yet.

## Evidence

A spec takes the screenshots the issue asks for itself: `await page.screenshot({ path: test.info().outputPath('<what>-<theme>-<viewport>.png') })`. On a PR from an `agent/…` branch or labelled `agent-harness`, CI's `e2e-evidence` job pushes the screenshots that passing specs the PR changes took to the `agent-evidence` branch and posts them as one PR comment. Paste the `--list` output in the PR — see "Evidence for a PR" in `e2e/README.md`.

## Safety

Test origins only (`127.0.0.1:4173`/`5174`, never `dev.dotyou.cloud:5173` or a real Homebase), never a tool attached to a real browser profile, `assertTestOrigin(page)` before any mutating `page.evaluate()` or storage write. Full detail in the README's "Safety rules" section.
