---
description: Work agent-ready issues: implement → verify → PR
argument-hint: <epic#|issue#…> [--dry] [--loop] [--max N]
---
Run the agent harness on: $ARGUMENTS

0. Clean up finished runs: for each worktree under `.claude/worktrees/` whose branch is `agent/<n>-…` and has no open PR (`gh pr list -R 2002Bishwajeet/journal --state open --head <branch> --json number`), run `git worktree remove --force <path>` and `git branch -D <branch>` — but only while no `implement-epic` run or evidence agent is active, and skip any worktree with a dirty tree or commits not on `origin` (`git -C <path> status --porcelain`, `git -C <path> log @{u}.. 2>/dev/null` or no upstream): mid-wave, a worktree with no PR yet is an agent still working. Pushed branches stay on the remote.
1. Run `node scripts/harness/select.mjs <the issue/epic numbers from the arguments> --json` and print the ready/skipped table (`issue | title | ready/skip reason`).
2. If `--dry` was given, or nothing is ready, stop here (no Workflow run, no worktrees).
3. Take at most N ready issues (`--max N`, default 3), lowest Size first (S, M, L, unknown); list the rest as "skipped: over --max". Run the saved workflow `implement-epic` with args `{ "issues": <the ready array, each {number,title,size}>, "repoRoot": "<absolute path of this checkout>" }`. Invoking this command is the owner's opt-in to that workflow.
4. When it finishes, print the report as a table `issue | PR link / stopped: reason / skipped: reason` (skipped rows come from step 1).
5. Merge what is done: for each open `agent-harness` PR, merge it with `gh pr merge <n> -R 2002Bishwajeet/journal --merge --delete-branch` when every CI check passed (`gh pr checks <n>`; `e2e-live` may show as skipping), it is `MERGEABLE`, and no unchecked owner-only box in its body needs a human look (visual/real-device judgement). Leave the others open and name the blocking box in the report. If a PR is behind or conflicting after an earlier merge, `gh pr update-branch <n>` and let CI re-run; a real conflict stays for the owner.
6. If `--loop` was given: after merging, go straight back to step 0 with the same arguments. If harness PRs are still open with CI pending, wait with a Monitor/`until` loop polling `gh pr checks` every 5 minutes, then do step 5 again. Exit when a run selects nothing **and** no `agent-harness` PR is mergeable or pending, or 12 hours after the first run. Print the report after each wave.

Token cost: run this in a fresh session — every `--loop` wake-up re-reads this session's context.

Merge only per step 5 (CI green); never push to `main` directly, or edit other issues' bodies. Check `git status` in this checkout before and after each run; if it changed, an agent wrote outside its worktree — stop and report it.
