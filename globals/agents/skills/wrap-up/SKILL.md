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

Scope: files changed this session (session diff, not full repo history).

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

Before committing, run `git status` (never `-uall`) and flag anything the user might
not be tracking:

- Untracked files that look like real work product, not scratch/build output.
- Unstaged changes outside the files this session touched.
- Existing stashes.

Surface these; don't silently include or silently discard them. If something is
ambiguous, ask before staging it.

### 4. Commit

- Stage the files this session actually changed (plus any doc updates from step 2).
  Never blanket `git add -A`/`git add .`.
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
- Produce a short status summary: what shipped this session, what's still open.
- Produce a **paste-ready prompt** for a new chat: enough standalone context (repo,
  what was just finished, what's next, any constraint the user stated) that a fresh
  chat with no memory of this conversation can pick up immediately. Put it in its own
  fenced code block so it's a single copy action.

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
