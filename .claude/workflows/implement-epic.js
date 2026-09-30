export const meta = {
  name: 'implement-epic',
  description: 'Implement → verify → PR for agent-ready issues picked by scripts/harness/select.mjs',
  whenToUse: 'Run via /implement; args = { issues: [{number,title,size}], repoRoot }',
  phases: [
    { title: 'Implement', detail: 'one worktree per issue, 2 issues at a time' },
    { title: 'Simplify', detail: 'fresh agent trims over-engineering in the diff before verify' },
    { title: 'Verify', detail: 'fresh-context verifier on Sonnet; 1 fix round' },
    { title: 'Publish', detail: 'PR on pass, STOP comment + blocked label otherwise', model: 'haiku' },
  ],
}

const REPO = '2002Bishwajeet/journal'
const MAX_FIX_ROUNDS = 1 // a second failure usually needs a human; each round re-runs Opus + Sonnet
const LANES = 2 // 16 GB machine; heavy commands are serialised by serial.sh anyway
const { issues = [], repoRoot } = args || {}

// Implementer effort follows the issue's Size; unknown sizes get 'high'.
const EFFORT = { S: 'medium', M: 'high', L: 'xhigh' }

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'stopped'] },
    worktreePath: { type: 'string', description: 'absolute path of the worktree you worked in (pwd)' },
    branch: { type: 'string' },
    summary: { type: 'string' },
    changedFiles: { type: 'array', items: { type: 'string' } },
    condition: { type: 'string', description: 'the STOP condition that matched, if stopped' },
    details: { type: 'string' },
  },
  required: ['status', 'worktreePath', 'branch', 'summary', 'changedFiles'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          exitCode: { type: 'string', description: 'number, or "owner-run" / "skipped"' },
          tail: { type: 'string', description: 'last 10 lines of output' },
        },
        required: ['command', 'exitCode', 'tail'],
      },
    },
    problems: { type: 'array', items: { type: 'string' } },
    ownerOnly: { type: 'array', items: { type: 'string' }, description: 'acceptance boxes only the owner can check' },
    evidence: { type: 'array', items: { type: 'string' }, description: 'absolute paths of screenshots/traces the issue asks for' },
    e2eList: { type: 'string', description: 'verbatim `npx playwright test --list` output for the specs run, if any' },
  },
  required: ['verdict', 'checks', 'problems'],
}

const PUBLISH_SCHEMA = {
  type: 'object',
  properties: { result: { type: 'string', description: 'PR URL, or "stopped: <reason>"' } },
  required: ['result'],
}

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '')

// The implementer's worktree may be auto-removed once its tree is clean; the branch survives.
const cdInto = (impl) => `\`cd ${impl.worktreePath}\` first (if it no longer exists: \`git -C ${repoRoot} worktree add ${impl.worktreePath} ${impl.branch}\`, then cd)`

const HEAVY = `Run every build/test/lint/e2e/vitest/tsc/npm ci command ONLY as \`${repoRoot}/scripts/harness/serial.sh <cmd> > /tmp/agent-<issue>-<step>.log 2>&1; echo exit=$?\` (machine-wide lock, 16 GB machine), in the foreground with a 600000 ms timeout — never run_in_background: you must see the exit code before you return. Never let full output into your context: read only \`tail -40\` of the log, plus \`grep -nE 'FAIL|Error|error|✗|×' <log> | head -40\` when it failed.`

function implementPrompt(issue) {
  const branch = `agent/${issue.number}-${slug(issue.title)}`
  return `You are implementing GitHub issue #${issue.number} of ${REPO}: "${issue.title}".

1. You are in a fresh git worktree. Run \`pwd\` and \`git checkout -b ${branch} origin/main\`. If \`node_modules\` is missing, \`ln -s ${repoRoot}/node_modules node_modules\`.
2. Read the issue: \`gh issue view ${issue.number} -R ${REPO} --comments\`. Read AGENTS.md. Follow the issue exactly, including its STOP conditions. If a STOP condition applies, stop and return status "stopped" with the condition and details — do not improvise around it.
3. ${HEAVY}
4. Stay inside this worktree — never edit files under ${repoRoot} itself. Stay inside the issue's Scope.
5. Commit your work on the branch (conventional commit message referencing #${issue.number}; no Co-Authored-By or other attribution lines). Do NOT push, do NOT open a PR — a later stage does that.

Return the worktree path, branch, summary, changed files.`
}

// Not the /simplify skill: its reviewer forks inherit the task and commit/push over the worktree.
function simplifyPrompt(issue, impl) {
  return `You are the simplifier for issue #${issue.number} of ${REPO}. The implementation is committed on branch ${impl.branch} in the worktree ${impl.worktreePath}. ${cdInto(impl)} and work only there. Do NOT invoke any skill and do NOT spawn subagents.

Read \`git diff origin/main...HEAD\` and CLAUDE.md sections 2–3. Cut over-engineering in the lines this branch added: unrequested abstractions or options, single-use helpers, re-implemented stdlib/existing \`@/lib/utils\` helpers, needless useCallback/useMemo/useState, defensive code for impossible cases, dead code the branch introduced, verbose comments. Keep behaviour, tests, input validation and data-loss error handling. Don't touch lines the branch didn't change.
If you changed anything: ${HEAVY} Run \`npm run build\`, \`npm run lint\` and \`npm run test\` that way; if any fails and you can't fix it quickly, \`git checkout -- .\` to drop your edits. Commit passing edits as \`refactor: simplify #${issue.number}\` (no attribution lines). Do not push.
Return the same fields as the implementer (status "done"), with summary = what you removed (or "nothing to simplify").`
}

function verifyPrompt(issue, impl) {
  return `You are the verifier for issue #${issue.number} of ${REPO}. The implementation is committed on branch ${impl.branch} in the worktree ${impl.worktreePath}. ${cdInto(impl)} and work only there. You are READ-ONLY on source files: never edit, commit or push.

- Read the issue: \`gh issue view ${issue.number} -R ${REPO}\`. If \`.claude/skills/e2e-verify/SKILL.md\` exists in the worktree, read and follow it.
- Run the commands in the issue's \`## Verification\` section in order, but e2e ones (\`npm run e2e…\`) first. ${HEAVY}
- Never run \`npm run e2e:live\` — record it as exitCode "owner-run". If the section says e2e is blocked on #196 and \`playwright.config.ts\` is missing, run its interim checks instead.
- Check each \`## Acceptance criteria\` box you can check by command; list the ones only the owner can do (real identity, e2e:live) in ownerOnly.
- Review \`git diff origin/main...HEAD\` adversarially: look for real bugs and for files changed outside the issue's Scope. Each becomes a concrete, actionable entry in problems.
- verdict = "pass" only if every command you ran exited 0 and problems is empty.
Implementer summary: ${impl.summary}`
}

function fixPrompt(issue, impl, verdict) {
  return `You implemented issue #${issue.number} of ${REPO} on branch ${impl.branch} in worktree ${impl.worktreePath}. ${cdInto(impl)} and work only there. A verifier found these problems:
${verdict.problems.map((p) => `- ${p}`).join('\n')}

Failed checks:
${verdict.checks.filter((c) => c.exitCode !== '0' && c.exitCode !== 'owner-run').map((c) => `$ ${c.command} (exit ${c.exitCode})\n${c.tail}`).join('\n\n') || '(none)'}

Fix them within the issue's Scope, re-run the failing commands, and commit. ${HEAVY} If fixing would require going outside the Scope or a STOP condition now applies, return status "stopped". Do not push.`
}

function publishPrompt(issue, impl, verdict) {
  if (impl.status === 'stopped') {
    return `Record a STOP for issue #${issue.number} of ${REPO}. Do exactly this and nothing else:
1. \`gh label create blocked --color B60205 --description "Agent hit a STOP condition; see last comment" -R ${REPO} 2>/dev/null || true\`
2. \`gh issue comment ${issue.number} -R ${REPO} --body-file <file>\` where the file says the agent harness stopped, and gives: STOP condition "${impl.condition || 'unspecified'}"; details: ${JSON.stringify(impl.details || impl.summary)}; branch \`${impl.branch}\`; last verifier problems: ${JSON.stringify(verdict?.problems || [])}.
3. \`gh issue edit ${issue.number} -R ${REPO} --add-label blocked\`
4. ${cdInto(impl)}; if \`git log origin/main..HEAD --oneline\` is non-empty, \`git push -u origin ${impl.branch}\`. Never push to main.
No PR. Return result "stopped: <condition>".`
  }
  return `Open the PR for issue #${issue.number} of ${REPO}. ${cdInto(impl)}. Do exactly this:
1. \`gh label create agent-harness --color 5319E7 --description "PR opened by the agent harness" -R ${REPO} 2>/dev/null || true\`
2. \`git push -u origin ${impl.branch}\` (never push to main).
3. For each evidence file in ${JSON.stringify(verdict.evidence || [])}: if \`gh api repos/${REPO}/releases -q '.[]|select(.name=="Agent evidence")|.id'\` prints nothing, \`gh release create agent-evidence --draft --title "Agent evidence" --notes "" -R ${REPO}\` (drafts aren't found by tag, so never create blindly); copy it to \`${issue.number}-<basename>\`, \`gh release upload agent-evidence <that file> --clobber -R ${REPO}\`, and note its asset URL (\`gh release view agent-evidence -R ${REPO} --json assets\`).
4. Write the PR body to a file: first line \`Closes #${issue.number}\`; a \`## Summary\` for a reviewer: what changed and why, rewritten from the implementer notes below (drop anything about commits, pushing or PRs); a markdown table \`command | exit | result\` for every check below; each check's tail in a \`<details><summary>command</summary>\` block with a fenced code block; the e2e list output verbatim if present; owner-only items as unchecked \`- [ ]\` boxes; evidence asset links. No attribution lines (no "Generated with Claude Code", no Co-Authored-By).
5. \`gh pr create -R ${REPO} --base main --head ${impl.branch} --label agent-harness --title ${JSON.stringify(`${issue.title} (#${issue.number})`)} --body-file <file>\`
Never merge. Return the PR URL.

Implementer notes: ${JSON.stringify(impl.summary)}
Checks: ${JSON.stringify(verdict.checks)}
e2e list: ${JSON.stringify(verdict.e2eList || '')}
Owner-only: ${JSON.stringify(verdict.ownerOnly || [])}`
}

async function runIssue(issue) {
  const tag = `#${issue.number}`
  const effort = EFFORT[issue.size] || 'high'
  let impl = await agent(implementPrompt(issue), {
    label: `implement ${tag}`, phase: 'Implement', schema: IMPL_SCHEMA, isolation: 'worktree', effort,
  })
  if (!impl) return { issue: issue.number, result: 'stopped: implementer died' }

  if (impl.status === 'done') {
    const simp = await agent(simplifyPrompt(issue, impl), {
      label: `simplify ${tag}`, phase: 'Simplify', schema: IMPL_SCHEMA, model: 'sonnet', effort: 'medium',
    })
    if (simp?.summary) log(`${tag}: simplify — ${simp.summary}`)
  }

  let verdict = null
  for (let round = 0; impl.status === 'done'; round++) {
    verdict = await agent(verifyPrompt(issue, impl), {
      label: `verify ${tag}${round ? ` (round ${round + 1})` : ''}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet', effort: 'high',
    })
    if (!verdict) { impl = { ...impl, status: 'stopped', condition: 'verifier died' }; break }
    if (verdict.verdict === 'pass') break
    if (round === MAX_FIX_ROUNDS) {
      impl = { ...impl, status: 'stopped', condition: 'verification still failing', details: verdict.problems.join('; ') }
      break
    }
    log(`${tag}: verify failed (${verdict.problems.length} problems), fix round ${round + 1}`)
    const fixed = await agent(fixPrompt(issue, impl, verdict), {
      label: `fix ${tag} (round ${round + 1})`, phase: 'Implement', schema: IMPL_SCHEMA, effort,
    })
    impl = fixed ? { ...impl, ...fixed, worktreePath: impl.worktreePath, branch: impl.branch } : { ...impl, status: 'stopped', condition: 'fixer died' }
  }

  const pub = await agent(publishPrompt(issue, impl, verdict), {
    label: `publish ${tag}`, phase: 'Publish', schema: PUBLISH_SCHEMA, model: 'haiku', effort: 'low',
  })
  return { issue: issue.number, result: pub?.result || `publish failed (${impl.status})` }
}

if (!repoRoot) throw new Error('args.repoRoot is required')
if (!issues.length) return { report: [] }

// Two lanes pull from one queue: at most LANES issues in flight, no barrier between issues.
const queue = [...issues]
const report = []
await parallel(Array.from({ length: Math.min(LANES, queue.length) }, () => async () => {
  while (queue.length) {
    const issue = queue.shift()
    const row = await runIssue(issue).catch((e) => ({ issue: issue.number, result: `error: ${e.message}` }))
    report.push(row)
    log(`#${row.issue}: ${row.result}`)
  }
}))
return { report }
