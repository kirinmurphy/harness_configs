# Convention Capture

Conversations with an agent surface decisions, conventions, and architectural choices that would otherwise pass by unnoticed. Convention capture is a lightweight, default-on behavior that helps those moments stand out: when a convention or architectural decision is confirmed in chat, the agent flags it inline so the user can see it clearly. It is one of the config panel's **Chat-Time Output** toggles — on by default, and the user can turn it off.

It is not a workflow and the user does not trigger it. It writes nothing. It is just additional, well-formatted context generated in the conversation — a recommendation the user is free to act on however they want.

## How it works

When a convention or decision is confirmed by explicit user signal or clear mutual agreement, the agent flags it inline in chat on its own line:

> 📌 **Capture candidate:** use named exports, not default exports

The format is always this exact blockquote + emoji + bold pattern, never embedded in a paragraph. No file writes, no automation, no follow-up workflow — the flag is the whole behavior.

### What qualifies

Flagged: naming/file/import conventions, architectural decisions, business logic, tool choices, and anything the user explicitly asks to remember.

Not flagged: debugging steps, temporary fixes, generic knowledge, already-documented facts, or in-progress work.

### Harness parity

The behavior ships as the `convention-capture` rules package
(`globals/packages/convention-capture/rules.md`). Enabling it merges the inline-flagging
rule into both the Claude rules file (`~/.claude/CLAUDE.md`) and the Codex rules file
(`~/.codex/AGENTS.md`), so Claude and Codex behave identically; disabling it removes the
block from both.

## Why flag-only

- Hooks can't read the transcript — only the agent sees the conversation where decisions surface.
- A surfaced recommendation lets the user decide what to keep without the agent over-capturing noise or writing files on its own.
- Keeping it to a consistent, visible format makes the candidates easy to scan and act on later.
