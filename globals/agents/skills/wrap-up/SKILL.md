---
name: wrap-up
description: >
  Use ONLY when the user explicitly asks to wrap up, close out, or finish the current
  chat/session before starting a new one — via the `/wrap-up` command or a clear
  instruction like "wrap this up", "let's close this out", "get this ready for a new
  chat". Runs a fixed sequence: self-review the code changed this session, sync
  relevant docs (including project-specific docs like an abstraction-matrix when the
  project has one), flag stray/uncommitted files, commit, then produce a status
  summary and a ready-to-paste handoff prompt for the next chat. Do not auto-invoke on
  ordinary edits, do not trigger on the mere presence of a diff, and do not run mid-task
  — this is an end-of-session action.
---

# Wrap Up

## Overview

Wrap Up closes out a work session cleanly so the next chat can start cold without
re-deriving context. It reviews what was built, brings docs in line with it, checks
for anything left uncommitted, commits, and hands back both a status summary and a
paste-ready prompt for a fresh chat.

It is the session-boundary counterpart to `tighten` (code-quality mid-session) and
`project-context` (doc refresh on demand) — wrap-up orchestrates both plus commit and
handoff, only when the user is ending the session.

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

- Load `tighten` and run its review loop against the scoped files: optimizations,
  functionality gaps, intuitiveness/naming, project-pattern conformance.
- Apply fixes that don't change intended behavior, same as `tighten`'s own rule. Leave
  genuinely low-risk/cosmetic items as notes instead of silently changing more.
- Skip this step only if there is no code diff this session (docs-only or planning
  session) — say so rather than fabricating a review.

### 2. Sync documentation

- If the project has a Project Context doc set (`docs/project-context/`,
  `docs/handoff/`, or wherever `project-context.config.json` / `package.json`
  `"projectContext"` points), load the `project-context` skill and update the docs
  touched by this session's changes.
- Separately, check for any other project-specific tracking doc implied by the
  session's own work — e.g. an abstraction matrix, decision log, architecture doc,
  ADR directory, changelog. These are project-defined, not roborepo-defined: find them
  by name/convention already established in the repo (search for the doc, don't invent
  a new one) and update the ones this session's changes actually affect.
- Do not restructure or rewrite docs wholesale. Small, targeted edits, preserving
  existing structure — same discipline as `project-context`.
- Report drift found but not fixed, separately from what was changed.

### 3. Check for stray or uncommitted state

Before committing, run `git status` (never `-uall`) and diff its output against the
enumerable edit set from step 1. Anything in `git status` that is NOT in that set is stray —
flag it, don't touch it:

- Untracked files that look like real work product, not scratch/build output.
- Modified/staged files this conversation did not edit — including pre-existing uncommitted
  work that predates this session. Report these by path; never assume they're safe to ignore
  or safe to include.
- Existing stashes.

Surface these; don't silently include or silently discard them. If something is
ambiguous, ask before staging it.

### 4. Commit

- Stage exactly the enumerable set from step 1 (plus any doc updates from step 2), by name.
  Never blanket `git add -A`/`git add .`, and never stage a file flagged as stray in step 3.
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
- If nothing is outstanding, say so plainly rather than inventing a next step.
- Produce a short status summary (for the chat, not the pasted prompt): what shipped
  this session, what's still open.

**The paste-ready prompt.** Give the next chat enough standalone context to pick up
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

**Rendering.** The prompt body goes in its own fenced code block so the terminal's copy
button grabs exactly the prompt and nothing else. Frame it with an ANSI-colored header
line printed directly ABOVE the fence and a matching colored `=` rule directly BELOW it —
both outside the fence, so they render in real color and are visually clearly not part
of what gets pasted. Match the rule's width to the header line. Use the same color for
both (cyan `\e[36m` is a good default; reset with `\e[0m`). Example shape:

```text
<cyan>─── HANDOFF: paste into the next chat ───<reset>
```<fenced prompt body — the only thing meant to be copied>```
<cyan>=========================================<reset>
```

The header/footer are delimiters only; the copyable content is the fenced body between
them.

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
