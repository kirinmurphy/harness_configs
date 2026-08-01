---
id: gemini-cli-provider-integration
priority: medium
next_action: Read the Gemini CLI Policy Engine docs (Open question 3) to decide the permissions adapter target, then write globals/harnesses/gemini/provider.json declaring the full verified capability set (root-config, rules, permissions, hooks, skills, slash-commands, mcp)
blocked_by: []
depends_on:
  - discoverable-harness-provider-architecture
related:
  - discoverable-harness-provider-architecture
reviewed_commit: 06f887b7e40ca2fef38af01215f9eef900499f0b
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

## Gemini CLI shape (verified against a real install)

Originally gathered from `google-gemini/gemini-cli` public docs, then verified by installing
`@google/gemini-cli@0.53.1` locally (`npm install -g @google/gemini-cli`), running `gemini --help`
and each relevant subcommand's `--help`, and reading the bundled docs/examples shipped inside the
installed package itself (`bundle/docs/hooks/reference.md`, `bundle/docs/cli/skills.md`,
`bundle/examples/{hooks,skills}/`) — these ship with the exact installed version, so they're more
authoritative than the web docs for this version. `gemini mcp add ... --scope user` was run for
real and its output inspected, then removed; no other state-changing commands were run (no auth,
no chat).

| Element | Claude | Codex | Gemini CLI (verified) |
| --- | --- | --- | --- |
| Executable | `claude` | `codex` | `gemini` |
| Home dir | `~/.claude/` | `~/.codex/` | `~/.gemini/` |
| Root config | `~/.claude/settings.json` (JSON) | `~/.codex/config.toml` (TOML) | `~/.gemini/settings.json` (JSON) |
| Rules file | `~/.claude/CLAUDE.md` | `~/.codex/AGENTS.md` | `~/.gemini/GEMINI.md` (global) + project/ancestor discovery up to `.git` or home, concatenated, filename configurable via `context.fileName`. Not independently re-verified hands-on (no chat session run), but corroborated by `gemini hooks migrate --from-claude` and the SKILL.md filename match below — Gemini's docs are consistent with Claude's model elsewhere, no contradicting evidence found. |
| Permissions | `permissions.allow`/`deny`/`ask` arrays in `settings.json` | `approval_policy`/`sandbox_mode` in `config.toml` + `rules/default.rules` + runtime ask hook | `tools.allowed`/`tools.exclude`/`tools.core` arrays in `settings.json` (flagged `[DEPRECATED: Use Policy Engine instead]` in `gemini --help`), plus `--approval-mode default\|auto_edit\|yolo\|plan` and a `--policy`/`--admin-policy` flag pointing at a newer Policy Engine not yet researched in detail. Needs a closer look before the manifest is final — see Open questions. |
| Hooks | `settings.json` wiring, JSON control output the harness obeys | dedicated `hooks.json`, plain-text output the harness shows | **Confirmed real, inside `settings.json`'s `hooks` object** (`bundle/docs/hooks/reference.md`), not a separate file. Same location as Claude, and the output contract (`continue`, `stopReason`, `decision: "allow"\|"deny"`) is structurally close to Claude's obeyed-JSON-control-protocol model, not Codex's shown-text model. `gemini hooks migrate --from-claude` exists specifically to port Claude Code hooks — strong signal the two are meant to be compatible in shape. `gemini hooks <command>` is a first-class CLI subcommand. |
| Skills | `~/.claude/skills/` | `~/.codex/skills/` | **Confirmed real**: `~/.gemini/skills/` (also aliased at `~/.agents/skills/`, an interop path shared across tools — `bundle/docs/cli/skills.md`), same `SKILL.md`-per-folder convention as Claude/Codex (confirmed via the bundled `examples/skills/skills/greeter/SKILL.md`). Full lifecycle CLI: `gemini skills list/enable/disable/install/link/uninstall`, closer to Claude's model than expected — not a capability gap after all. |
| Slash commands | `~/.claude/commands/*.md` | `~/.codex/commands/*.md` | `~/.gemini/commands/*.toml` (global) + `.gemini/commands/*.toml` (project), namespaced by path (`git/commit.toml` → `/git:commit`). Different format (TOML, not Markdown) — confirmed via bundled `examples/custom-commands/`, real structural difference worth exercising the renderer against. Not re-verified hands-on this pass (no chat session run to invoke `/commands list`), but format is documented consistently across sources. |
| MCP | Native live store + permission entries | `config.toml` `mcp_servers` table | **Confirmed via real `gemini mcp add test-server echo hello --scope user`**: writes to `~/.gemini/settings.json`'s `mcpServers` key exactly as researched — `{command, args}` for stdio (also supports `env`, `cwd`, `url`, `httpUrl`, `headers`, `timeout`, `trust`, `description`, `includeTools`, `excludeTools` per `gemini mcp add --help`). `gemini mcp add/remove/list/enable/disable` is a first-class CLI subcommand, `--scope user\|project` controls global vs. project-local, defaults to `project`. |
| Root config format | JSON | TOML | JSON |

Verification corrected two assumptions from the original doc-only research: hooks and skills are
both real, well-supported, first-class features (not gaps) — closer to Claude's shape on both axes
than Codex's. The remaining open item is the newer Policy Engine vs. the `tools.allowed`/`exclude`
arrays, since `gemini --help` flags the array form as deprecated in favor of it and the Policy
Engine wasn't researched in this pass.

## Open questions

1. ~~Does Gemini CLI have a hooks mechanism at all~~ **Resolved: yes**, inside `settings.json`'s
   `hooks` key, Claude-shaped (obeyed JSON control output), confirmed via the bundled hooks
   reference doc and the `hooks migrate --from-claude` subcommand. No further research needed here.
2. ~~Is there any Gemini CLI equivalent to Claude/Codex's on-demand skills model~~ **Resolved:
   yes**, `~/.gemini/skills/`, same `SKILL.md` convention, full CLI lifecycle. No further research
   needed here.
3. `tools.allowed`/`tools.exclude` is flagged deprecated in favor of a Policy Engine
   (`--policy`/`--admin-policy` flags exist; `geminicli.com/docs/core/policy-engine` was surfaced by
   docs but not read in this pass). Before writing the permissions adapter: is the Policy Engine the
   right target to render into instead of the deprecated arrays, and does it support a real 3-state
   `ask` (unlike Codex's binary rules layer, which needed a runtime hook to recover `ask`)? This
   could mean Gemini's permissions story is actually *better* than Codex's out of the box — needs
   confirming before assuming Codex's ask-recovery-hook pattern needs porting over.
4. `--approval-mode yolo`/`plan` are full-autonomy and read-only modes with no roborepo equivalent
   on Claude or Codex. Out of scope to design roborepo controls for either in this plan — noted so
   they aren't silently assumed away, not because they need solving here.

None of these block Phase 1's remaining work (writing the manifest); question 3 blocks finalizing
the permissions adapter design in Phase 2.

## Phase 1: Verify and add the provider manifest

- [x] Install `gemini` CLI locally (`npm install -g @google/gemini-cli`, v0.53.1) and verify config
  shape via `--help` output, bundled docs/examples inside the installed package, and one real
  `gemini mcp add ... --scope user` call inspected then removed. Confirmed: `~/.gemini/settings.json`
  (JSON root config), hooks live inside `settings.json`'s `hooks` key (not a separate file, Claude-
  shaped output contract), skills at `~/.gemini/skills/` with full CLI lifecycle (Claude-shaped, not
  a gap), MCP via `settings.json`'s `mcpServers` key with `--scope user|project`. Did not run a full
  interactive/authenticated session — `GEMINI.md` rules-file discovery and the TOML commands
  directory were not independently re-verified hands-on this pass, though nothing contradicts the
  original doc research for either. See the shape table above for full detail and what's still
  unverified.
- [ ] Resolve Open question 3 (Policy Engine vs. deprecated `tools.allowed`/`exclude` arrays, and
  whether the Policy Engine supports a real 3-state `ask`) — read
  `geminicli.com/docs/core/policy-engine` and/or the bundled `bundle/policies/` directory before
  finalizing the permissions adapter design.
- [ ] If pursuing further hands-on verification, confirm `GEMINI.md` discovery/precedence and the
  `~/.gemini/commands/*.toml` format with a real authenticated session (requires Google auth, not
  needed for the manifest/adapter groundwork above).
- [ ] Add `globals/harnesses/gemini/provider.json` following `provider-manifest.schema.json`, with
  `detection.executables: ["gemini"]`, `detection.homeCandidates: ["~/.gemini"]`,
  `detection.configCandidates: ["~/.gemini/settings.json"]`, and `paths` covering `home`,
  `rootConfig`, `rules`, `commands`, `skills`, and `hooks` (all confirmed to exist — declare the
  full capability set this time, unlike the original hedge to declare fewer).
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
  same generator pattern as CLAUDE.md/AGENTS.md), `permissions` (render into either the deprecated
  `tools.allowed`/`tools.exclude` arrays or the Policy Engine — resolve Open question 3 first, since
  it decides which target this adapter renders into), `hooks` (settings.json's `hooks` key, Claude-
  shaped JSON control output — expect to share more logic with Claude's hooks wiring than Codex's
  separate-file model), `skills` (`~/.gemini/skills/` symlink, same mechanism as Claude/Codex's
  `skills` capability, not a new one), `slash-commands` (TOML render — new format for the existing
  renderer, not just a new output path), and `mcp` (register into `settings.json`'s `mcpServers`
  key).
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
