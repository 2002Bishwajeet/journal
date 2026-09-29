---
description: Work agent-ready issues: implement → verify → PR
argument-hint: <epic#|issue#…> [--dry] [--loop] [--max N]
---
Run the agent harness on: $ARGUMENTS

0. Clean up finished runs: for each worktree under `.claude/worktrees/` whose branch is `agent/<n>-…` and has no open PR (`gh pr list -R 2002Bishwajeet/journal --state open --head <branch> --json number`), run `git worktree remove --force <path>` and `git branch -D <branch>`. Pushed branches stay on the remote.
1. Run `node scripts/harness/select.mjs <the issue/epic numbers from the arguments> --json` and print the ready/skipped table (`issue | title | ready/skip reason`).
2. If `--dry` was given, or nothing is ready, stop here (no Workflow run, no worktrees).
3. Take at most N ready issues (`--max N`, default 3), lowest Size first (S, M, L, unknown); list the rest as "skipped: over --max". Run the saved workflow `implement-epic` with args `{ "issues": <the ready array, each {number,title,size}>, "repoRoot": "<absolute path of this checkout>" }`. Invoking this command is the owner's opt-in to that workflow.
4. When it finishes, print the report as a table `issue | PR link / stopped: reason / skipped: reason` (skipped rows come from step 1).
5. If `--loop` was given: while any PR labelled `agent-harness` is open, wait with a Monitor/`until` loop that polls `gh pr list -R 2002Bishwajeet/journal --label agent-harness --state open --json number` every 5 minutes until that set shrinks (the owner merged or closed one), then go back to step 0 with the same arguments. Exit when a run selects nothing **and** no `agent-harness` PR is open, or 12 hours after the first run. Print the report after each wave.

Token cost: run this in a fresh session — every `--loop` wake-up re-reads this session's context.

Never merge PRs, push to `main`, or edit other issues' bodies. Check `git status` in this checkout before and after each run; if it changed, an agent wrote outside its worktree — stop and report it.
