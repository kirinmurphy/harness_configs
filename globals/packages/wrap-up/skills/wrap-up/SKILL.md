---
name: wrap-up
description: >
  Use ONLY when the user explicitly asks to wrap up, close out, or finish the current
  chat/session before starting a new one — via the `/wrap-up` command or a clear
  instruction like "wrap this up", "let's close this out", "get this ready for a new
  chat". Runs a fixed sequence: self-review the code changed this session, sync
  project-specific tracking docs when they exist (e.g. an abstraction-matrix), flag
  stray/uncommitted files, commit, then produce a status summary and a ready-to-paste
  handoff prompt for the next chat. Do not auto-invoke on ordinary edits, do not
  trigger on the mere presence of a diff, and do not run mid-task — this is an
  end-of-session action.
---

# Wrap Up

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
**🧹 WRAP UP — closing out this session**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Print a separator line like the one above (plain repeated characters — `━`, `=`, or
`*` all work; a bold emoji-prefixed label between two rules) as the FIRST thing in the
chat response when this skill starts running, before any review/commit output. This is
plain markdown text emitted directly in the response — not a shell/ANSI escape (see the
Rendering note under step 5 for why that distinction matters). Its job is to make the
start of a wrap-up visually obvious in a long conversation, the same way the handoff
block at the end is visually obvious.

## Overview

Wrap Up closes out a work session cleanly so the next chat can start cold without
re-deriving context. It reviews what was built, brings docs in line with it, checks
for anything left uncommitted, commits, and hands back both a status summary and a
paste-ready prompt for a fresh chat.

It is the session-boundary counterpart to a mid-session code-quality review and targeted doc
sync — wrap-up orchestrates both plus commit and handoff, only when the user is ending the session.

## When To Activate

Explicit invocation only:

- `/wrap-up`
- "wrap this up", "close this out", "wrap up this chat", "get this ready for a new chat"

Do not run automatically at the end of a task, on a large diff, or because the
conversation looks finished. The user decides when the session is over.

## Workflow

### 1. Review the code

Scope: the files this conversation actually edited or created — the concrete set touched by
Edit/Write/NotebookEdit tool calls in this conversation. This is an enumerable set from the
conversation history, not "the working tree diff": a repo can carry pre-existing uncommitted
changes from before the session started, or from other work in progress, and those are not
in scope here even though `git diff`/`git status` can't tell them apart from session work.
If you cannot enumerate this set (e.g. picking up mid-session with no memory of earlier edits),
say so explicitly rather than guessing from the working tree.

- If a dedicated code-quality review skill exists in the current environment, load it and run
  its review loop against the scoped files. Otherwise review the scoped files directly for:
  optimizations, functionality gaps, intuitiveness/naming, project-pattern conformance.
- Apply fixes that don't change intended behavior. Leave genuinely low-risk/cosmetic items as
  notes instead of silently changing more.
- Skip this step only if there is no code diff this session (docs-only or planning
  session) — say so rather than fabricating a review.

### 2. Sync documentation

- Check for any project-specific tracking doc implied by the session's own work — e.g.
  an abstraction matrix, decision log, architecture doc, ADR directory, changelog. These
  are project-defined, not roborepo-defined: find them by name/convention already
  established in the repo (search for the doc, don't invent a new one) and update the
  ones this session's changes actually affect. If a dedicated doc-refresh skill exists
  in the current environment, load it; otherwise proceed without one.
- Do not restructure or rewrite docs wholesale. Small, targeted edits, preserving existing
  structure.
- Report drift found but not fixed, separately from what was changed.

### 3. Check for stray or uncommitted state

Before committing, run `git status` (never `-uall`) and diff its output against the
enumerable edit set from step 1.

First, stage the files this conversation actually edited or created, plus any documentation
updates from step 2, by explicit path. This defines the candidate session commit.

After those files are staged, inspect all remaining modified, deleted, staged, and untracked
paths in `git status`:

- If a remaining code or documentation change was not touched in this session but is directly
  related to the candidate session commit, include it in the commit. Stage it by explicit path
  and say why it belongs with the session work.
- If a remaining path is unrelated to the candidate session commit, leave it unstaged and
  classify it by likely commit domain. Use concrete domains from the files and diffs, such as
  "config portal token-chip UI", "context-cost CLI", or "plan docs".
- If relatedness is ambiguous, ask before staging it. Do not guess from path names alone when
  the diff could belong to a different task.

Unrelated or ambiguous leftovers are still stray work. Flag them; don't silently include or
silently discard them:

- Untracked files that look like real work product, not scratch/build output.
- Modified/staged files this conversation did not edit — including pre-existing uncommitted
  work that predates this session. Report these by path; never assume they're safe to ignore
  or safe to include.
- Existing stashes.

Determine how many commits worth of unrelated code remain outstanding. Finish the normal
wrap-up deliverables, then ask whether the user wants those leftovers committed too. The
question must articulate the proposed commit domain(s). If multiple proposed commits remain,
offer exactly these choices: commit the separate commits, commit them all together, or do
nothing and wait for instruction.

### 4. Commit

- Commit exactly the staged candidate set from steps 1-3. Never blanket `git add -A`/`git add .`,
  and never stage a file flagged as unrelated stray work in step 3.
- Commit message: standard git conventions (see root `CLAUDE.md` commit guidance, not
  caveman mode) — summarize the *why* pulled from the session's own goal, not just a
  diff restatement. If the session covered multiple unrelated changes, say so and
  either split into multiple commits or ask which grouping the user wants.
- Do not push. Committing is as far as this skill goes unless the user separately asks
  to push.
- If there's nothing to commit (step 1/2 made no changes and nothing was already
  staged), skip the commit and say so.

### 5. Status + handoff prompt

Do not skip this step even if steps 1-4 found nothing to change — it's the actual
deliverable of a "wrap up."

- Scan the session for open threads: explicit TODOs left in code/docs, questions the
  user deferred, follow-ups mentioned but not started, or the next unstarted step in
  an agreed plan.
- Classify open threads before writing the handoff:
  - **Must-fix / clear continuation:** concrete bugs, incomplete promised work, validation
    blockers, or follow-ups the user clearly asked to continue. These always go in the
    handoff prompt when one is produced.
  - **Ambiguous priority / maybe-later:** ideas, optional polish, speculative improvements,
    or deferred questions where the user has not committed to continuing.
- After committing but before writing the handoff prompt, review the open-thread list:
  - Add every must-fix / clear continuation item to the handoff prompt.
  - For ambiguous priority items, ask the user what to do with each item before including it.
    Offer exactly these choices: **include details in a handoff prompt**, **add it to the
    backlog as a new task**, or **forget about it**.
  - If the user chooses backlog, load `plan-docs` and create a backlog plan for that issue
    before committing. Stage that plan with the same wrap-up/session commit, not a separate
    follow-up commit. Include the new plan path in the status summary.
  - If the user chooses forget, omit it from the handoff and do not create a plan.
  - After handling each selected option, complete with the normal handoff/status response;
    do not stop at the prompt.
- If nothing is outstanding, say so plainly rather than inventing a next step.
- Produce a short status summary (for the chat, not the pasted prompt): what shipped
  this session, what's still open.

**Skip the handoff prompt when there's nothing to hand off.** If the scan finds no open
work — no tasks left in a plan doc, no deferred questions, no unstarted follow-ups —
state that the session is fully closed and stop there. Do not generate the paste-ready
prompt block (or its header/footer rule) in this case; a handoff prompt implies there is
a next task to run, and producing one anyway invents work that doesn't exist.

**The paste-ready prompt.** Only produced when step 5's scan found real open work. Give
the next chat enough standalone context to pick up
cold: repo + branch, what's next, and any constraint the user stated. Then apply these
filters to what you include:

- **Scope done-work to the next step's needs.** Only describe work completed this
  session when the next task actually depends on that context (a decision it must not
  re-litigate, an interface it will build on, a gotcha it will hit). If a piece of
  finished work is unrelated to what comes next, leave it out — the prompt is a runway
  for the next task, not a changelog of this one. When in doubt, prefer the shorter
  prompt.
- **Never reference commits or push state.** Do not name commit hashes, describe the
  local-vs-pushed commit situation, or tell the next chat to push. The user manages
  their own git history; the handoff is about work content, not VCS bookkeeping.
- **Do describe uncommitted/outstanding work** that the next chat needs to know exists
  (open plan items, a half-built feature, a deferred decision) — as work, by what it is
  and where it lives, without framing it in terms of commits.

**Rendering.** The prompt body goes in its own fenced code block so the copy button on
that block grabs exactly the prompt and nothing else. Frame it with a header line
directly ABOVE the fence and a matching rule directly BELOW it, both written as plain
markdown text in the chat response — never as a shell command whose output is piped
back (e.g. `Bash printf '\e[36m...'`). Match the rule's width to the header line.
Example shape:

```text
**─── HANDOFF: paste into the next chat ───**
```<fenced prompt body — the only thing meant to be copied>```
**═══════════════════════════════════════**
```

The header/footer are delimiters only; the copyable content is the fenced body between
them.

Do NOT use raw ANSI escape codes (`\e[36m`, `\033[...]`) for this or any other emphasis
in a chat response, even though they look like the obvious way to get color. They only
render as color when whatever is displaying the output treats it as a live terminal
stream. Markdown emphasis (bold/headers/etc.) you write directly into the response text
is a different mechanism — the chat surface parses that as markdown natively, which is
why *that* renders reliably as color/weight everywhere. But this header/footer is
produced by a tool call whose result is piped back as tool-output text, not written
directly into the response — some surfaces echo raw terminal streams straight through
(color renders), others treat tool output as inert logged text (you get the literal
`\e[36m` bytes on screen). There's no way to know in advance which one a given session
is using, so don't gamble on it: use markdown bold/rule characters written directly in
the chat text instead, which every surface renders the same way.

## What Wrap Up Must Not Do

- Do not run unless explicitly invoked.
- Do not push commits or open PRs — commit only, unless asked.
- Do not blanket-stage (`-A`/`.`) — name files.
- Do not invent a next step when none exists; say the session is fully closed instead.
- Do not restructure docs beyond the targeted updates the session's changes call for.
- Do not skip the review step silently — if skipped, say why.

## Risk Checkpoints

Take extra care, and say what to double-check, when the session's changes touched:
authentication; authorization/ownership/admin; database schema and migrations; API
behavior and mutations; environment variables and deployment config; file uploads and
storage; external integrations. Call these out in both the review step and the commit
message.
