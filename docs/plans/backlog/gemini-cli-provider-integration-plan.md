---
id: gemini-cli-provider-integration
priority: medium
next_action: Install gemini CLI locally and verify the researched config shape (settings.json, GEMINI.md, commands/, mcpServers) against the real ~/.gemini/ layout before writing the provider manifest
blocked_by: []
depends_on:
  - discoverable-harness-provider-architecture
related:
  - discoverable-harness-provider-architecture
reviewed_commit: 1c5dd78f80d32cba932ed19d658b7a2a6ce3e88f
---

# Gemini CLI Provider Integration

## Summary

Implement Gemini CLI as roborepo's third harness provider — the first real (non-synthetic) test of
the [discoverable harness provider architecture](../active/discoverable-harness-provider-architecture-plan.md)'s
registry/adapter contract. The synthetic third-provider tests added during that migration
(`config-synthetic-provider-check.mjs`, `telemetry-synthetic-provider-check.mjs`,
`root-config-merge-synthetic-provider-check.mjs`) prove the *plumbing* generalizes past two
providers; they do not prove a *real* provider's native configuration complexity fits the contract
without a schema or capability change. This plan is that proof.

Gemini CLI was chosen over Cursor CLI (the other candidate considered) specifically because its
public documentation is complete enough to write an accurate provider manifest without guessing:
confirmed global settings path, confirmed rules-file discovery and precedence, confirmed
permissions/tool-approval model, confirmed MCP registration, and confirmed custom-command
mechanism. Cursor CLI's docs left permissions, MCP registration format, and any skills/commands
equivalent underdocumented or contradictory across sources — remains a candidate for a later
"fourth provider" pass once Gemini has exercised the contract once for real; see
[Open questions](#open-questions) below for what to carry forward.

## Researched Gemini CLI shape

Gathered from `google-gemini/gemini-cli` docs (`google-gemini.github.io/gemini-cli`,
`geminicli.com`) as of this plan's `reviewed_commit`. Not yet verified against a real local
install — first task in Phase 1 is installing `gemini` and confirming this against the actual
`~/.gemini/` layout before any manifest is written as final.

| Element | Claude | Codex | Gemini CLI (researched) |
| --- | --- | --- | --- |
| Executable | `claude` | `codex` | `gemini` |
| Home dir | `~/.claude/` | `~/.codex/` | `~/.gemini/` |
| Root config | `~/.claude/settings.json` (JSON) | `~/.codex/config.toml` (TOML) | `~/.gemini/settings.json` (JSON) |
| Rules file | `~/.claude/CLAUDE.md` | `~/.codex/AGENTS.md` | `~/.gemini/GEMINI.md` (global) + project/ancestor discovery up to `.git` or home, concatenated, filename configurable via `context.fileName` |
| Permissions | `permissions.allow`/`deny`/`ask` arrays in `settings.json` | `approval_policy`/`sandbox_mode` in `config.toml` + `rules/default.rules` + runtime ask hook | `tools.allowed`/`tools.exclude`/`tools.core` arrays in `settings.json`, plus `--approval-mode default\|auto_edit\|yolo`. No native 3-state `ask` at the config layer — closer to Codex's binary-rules gap than Claude's real `ask` tier. |
| Hooks | `settings.json` wiring, JSON control output the harness obeys | dedicated `hooks.json`, plain-text output the harness shows | **No separate hooks file found in researched docs** — needs Phase 1 verification; may not exist, may live inside `settings.json`, or may be undocumented. Real open question, not an assumption to build on. |
| Skills | `~/.claude/skills/` | `~/.codex/skills/` | **No equivalent found.** Gemini CLI has commands (below) but nothing matching Claude/Codex's on-demand SKILL.md-bundle model. Likely an honest capability gap, not a research gap — see Open questions. |
| Slash commands | `~/.claude/commands/*.md` | `~/.codex/commands/*.md` | `~/.gemini/commands/*.toml` (global) + `.gemini/commands/*.toml` (project), namespaced by path (`git/commit.toml` → `/git:commit`). Different format (TOML, not Markdown) — a real structural difference worth exercising the renderer against. |
| MCP | Native live store + permission entries | `config.toml` `mcp_servers` table | `settings.json` `mcpServers` key: `{command, args, env, cwd, url, httpUrl, headers, timeout, trust, description, includeTools, excludeTools}` |
| Root config format | JSON | TOML | JSON |

The permissions and hooks stories are the two genuinely open items — everything else above is
documented clearly enough to draft the manifest against directly.

## Open questions

1. Does Gemini CLI have a hooks mechanism at all, and if so what file and what output contract
   (obeyed control protocol like Claude, or shown text like Codex, or something else)? If it
   genuinely has none, does the provider simply omit the `hooks` capability, or does roborepo need
   a documented "capability absent by design" distinction from "capability not yet migrated"
   (`stub-adapter.mjs`'s `notYetMigrated` currently means the latter, not the former)?
2. Is there any Gemini CLI equivalent to Claude/Codex's on-demand skills model, even under a
   different name? If confirmed absent, this provider will be roborepo's first real case of a
   harness that structurally cannot carry the `skills` capability — worth confirming the
   capability-adapter validation path (`validateCapabilityAdapters` in `contract.mjs`) already
   handles "provider declares fewer capabilities than Claude/Codex" cleanly, since every capability
   test to date has run against providers that declare the full set.
3. Gemini's `tools.allowed`/`tools.exclude` has no config-layer `ask` tier, same gap Codex has.
   Does Gemini CLI have anything like Codex's runtime permission-check hook to recover a 3-state
   decision, or does this provider simply not support `ask`-bucket entries at all (render step
   drops them, same asymmetry noted in `harnesses-explained.md` Step 3, but with no hook to close
   the gap this time)?
4. `--approval-mode yolo` is a full-autonomy mode with no roborepo equivalent on Claude or Codex.
   Out of scope to design roborepo controls for it in this plan — noted so it isn't silently
   assumed away, not because it needs solving here.

None of these block Phase 1 (install + verify); they block writing the final provider manifest and
choosing which capabilities to declare.

## Phase 1: Verify and add the provider manifest

- [ ] Install `gemini` CLI locally and run a real session; capture the actual `~/.gemini/` layout
  (`settings.json`, `GEMINI.md`, `commands/`, any hooks-related file) and diff it against the
  researched shape in this doc. Correct this doc's table before proceeding if reality differs.
- [ ] Resolve open questions 1-3 above against the real install (hooks existence/format, skills
  equivalent, ask-tier support).
- [ ] Add `globals/harnesses/gemini/provider.json` following `provider-manifest.schema.json`, with
  `detection.executables: ["gemini"]`, `detection.homeCandidates: ["~/.gemini"]`,
  `detection.configCandidates: ["~/.gemini/settings.json"]`, and `paths` covering `home`,
  `rootConfig`, `rules`, `commands`, plus `skills`/`hooks` only if Phase 1's verification confirms
  they exist. Declare only the capabilities the verified shape actually supports — do not carry
  Claude/Codex's full capability list forward by default.
- [ ] Add Gemini manifest fixtures alongside the existing Claude/Codex ones in
  `scripts/test/fixtures/harnesses/`.
- [ ] Confirm `scripts/doctor.sh`'s `check_harness_manifests` and
  `scripts/test/harness-manifest-check.mjs` validate the new manifest without changes to either
  check — this is the first real test of whether Phase 1 of the original migration's schema work
  generalizes past two providers' worth of real-world shape.

## Phase 2: Adapter implementation

- [ ] Add `scripts/harnesses/gemini/index.mjs` built via `defineHarnessProvider`, implementing
  `rootConfig` (JSON merge, closer to Claude's adapter than Codex's TOML one — expect to share more
  logic with `scripts/harnesses/claude/index.mjs` than with Codex's), `rules` (GEMINI.md render,
  same generator pattern as CLAUDE.md/AGENTS.md), `permissions` (render into `tools.allowed`/
  `tools.exclude`, decide the `ask`-bucket handling per Open question 3), `slash-commands` (TOML
  render — new format for the existing renderer, not just a new output path), and `mcp` (register
  into `settings.json`'s `mcpServers` key).
- [ ] For any capability Phase 1 confirmed Gemini CLI lacks (hooks and/or skills, pending
  verification), do not implement a stub that silently no-ops — either omit the capability from the
  manifest entirely (preferred, since `validateCapabilityAdapters` already rejects declaring a
  capability without its required adapter methods) or wire it through `stub-adapter.mjs`'s
  `notYetMigrated` only if the capability is real but genuinely not yet built, not if it's absent
  by design. This distinction is Open question 1 — resolve it before choosing.
- [ ] Add characterization tests for the new adapter's render output, matching the style of
  `permissions-render-live-characterization-check.mjs` and `root-config-merge-characterization-check.mjs`.

## Phase 3: Consumer verification

- [ ] Run the full existing test suite and doctor with the Gemini provider manifest present but
  disabled — confirms zero-additional-provider-enabled behavior is unaffected, matching the
  "Zero detected providers leaves the RoboRepo CLI usable" validation criterion from the parent
  plan.
- [ ] Enable Gemini in a real or sandboxed home directory and run `roborepo update`, `roborepo
  doctor --installed`, `roborepo permissions --check`, `roborepo rules --check`, `roborepo skill
  render-commands --check`, `roborepo mcp add <test-server> --harness gemini` — this is the actual
  proof-of-contract: real native files written and verified, not synthetic-provider assertions.
- [ ] Revisit the two follow-up items already logged in the parent plan's "Third-provider-readiness
  bugs found in wrap-up review" section (`package-harness-config.mjs`'s `applyPackageComponentResult`
  hardcoding `"codex"`, `mcp.mjs`'s `mcpAdd` only acting on claude/codex) — Gemini is the concrete
  case that turns those from "a hypothetical third provider would break this" into a real bug to
  fix or a real pass to confirm, whichever it turns out to be.
- [ ] Update `docs/reference/internal/harness-anatomy.md` and `harnesses-explained.md` to include
  Gemini as a third worked example, not just Claude/Codex — this is the first real chance to
  confirm those docs' "two harnesses" framing generalizes to "N harnesses" in prose, not just in
  code.

## Validation

Same validation categories as the parent plan's Validation section apply here, scoped to Gemini
specifically:
- Gemini's manifest passes schema validation and `validateCapabilityAdapters`.
- `roborepo harness list`/`inspect`/`enable`/`disable` work against Gemini with no code change.
- A selector in CLI/portal surfaces shows Gemini once enabled, matching the "selector appears for
  two or more relevant providers" criterion with three real providers instead of two.
- Config and Telemetry portal views render Gemini without source changes (this was already proven
  synthetically; this plan proves it with a provider that has genuinely different native shape).
