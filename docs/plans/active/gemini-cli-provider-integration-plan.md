---
id: gemini-cli-provider-integration
priority: medium
next_action: Finish Phase 3 — the real proof-of-contract verification and 3 real bugs it surfaced (mergeRootConfig's hardcoded dispatcher, renderPermissionsTo missing a Gemini branch, mcpAdd missing a Gemini branch) are done and committed. Remaining: fix mcpApply's hardcoded claude/codex dispatch (package-level MCP server sync, distinct from the now-fixed single-server mcpAdd) and package-harness-config.mjs's applyPackageComponentResult hardcoding "codex" (both already logged in the parent plan's wrap-up review), triage the 6 files with literal ["claude","codex"] arrays, and update harness-anatomy.md/harnesses-explained.md to include Gemini as a third worked example.
blocked_by: []
depends_on:
  - discoverable-harness-provider-architecture
related:
  - discoverable-harness-provider-architecture
reviewed_commit: 2108bbeaddaba641e22e3752a5657a3faf6d3056
---

# Gemini CLI Provider Integration

## Summary

Implement Gemini CLI as roborepo's third harness provider — the first real (non-synthetic) test of
the [discoverable harness provider architecture](./discoverable-harness-provider-architecture-plan.md)'s
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
| Permissions | `permissions.allow`/`deny`/`ask` arrays in `settings.json` | `approval_policy`/`sandbox_mode` in `config.toml` + `rules/default.rules` + runtime ask hook | **Policy Engine**, TOML rule files at `~/.gemini/policies/*.toml` (User tier; Admin tier at OS-specific system paths; Workspace/project tier currently non-functional per Gemini's own docs — issue #18186). Each `[[rule]]` has `toolName`/`commandPrefix`/`commandRegex`/`mcpName`/`argsPattern` conditions, a `decision` of `allow`/`deny`/`ask_user` (**real native 3-state**, no runtime-hook recovery needed unlike Codex), and a `priority` (0-999) combined with tier base (`final_priority = tier_base + priority/1000`) to resolve conflicts. The older `tools.allowed`/`tools.exclude` arrays in `settings.json` are explicitly deprecated in favor of this. Confirmed via the bundled `docs/reference/policy-engine.md` and `bundle/policies/*.toml` example files (`read-only.toml`, `yolo.toml`, `sandbox-default.toml`, etc.) — not yet exercised hands-on with a real rule file. |
| Hooks | `settings.json` wiring, JSON control output the harness obeys | dedicated `hooks.json`, plain-text output the harness shows | **Confirmed real, inside `settings.json`'s `hooks` object** (`bundle/docs/hooks/reference.md`), not a separate file. Same location as Claude, and the output contract (`continue`, `stopReason`, `decision: "allow"\|"deny"`) is structurally close to Claude's obeyed-JSON-control-protocol model, not Codex's shown-text model. `gemini hooks migrate --from-claude` exists specifically to port Claude Code hooks — strong signal the two are meant to be compatible in shape. `gemini hooks <command>` is a first-class CLI subcommand. |
| Skills | `~/.claude/skills/` | `~/.codex/skills/` | **Confirmed real**: `~/.gemini/skills/` (also aliased at `~/.agents/skills/`, an interop path shared across tools — `bundle/docs/cli/skills.md`), same `SKILL.md`-per-folder convention as Claude/Codex (confirmed via the bundled `examples/skills/skills/greeter/SKILL.md`). Full lifecycle CLI: `gemini skills list/enable/disable/install/link/uninstall`, closer to Claude's model than expected — not a capability gap after all. |
| Slash commands | `~/.claude/commands/*.md` | `~/.codex/commands/*.md` | `~/.gemini/commands/*.toml` (global) + `.gemini/commands/*.toml` (project), namespaced by path (`git/commit.toml` → `/git:commit`). Different format (TOML, not Markdown) — confirmed via bundled `examples/custom-commands/`, real structural difference worth exercising the renderer against. Not re-verified hands-on this pass (no chat session run to invoke `/commands list`), but format is documented consistently across sources. |
| MCP | Native live store + permission entries | `config.toml` `mcp_servers` table | **Confirmed via real `gemini mcp add test-server echo hello --scope user`**: writes to `~/.gemini/settings.json`'s `mcpServers` key exactly as researched — `{command, args}` for stdio (also supports `env`, `cwd`, `url`, `httpUrl`, `headers`, `timeout`, `trust`, `description`, `includeTools`, `excludeTools` per `gemini mcp add --help`). `gemini mcp add/remove/list/enable/disable` is a first-class CLI subcommand, `--scope user\|project` controls global vs. project-local, defaults to `project`. |
| Root config format | JSON | TOML | JSON |

Verification corrected three assumptions from the original doc-only research: hooks, skills, and
permissions are all real, well-supported, first-class features — and permissions specifically turn
out to be the *strongest* of the three providers on this axis, not a gap. The Policy Engine's native
`ask_user` decision is a real 3-state at the config layer, something neither Claude (JSON arrays,
real `ask`) nor Codex (binary rules + a runtime hook to recover `ask`) gets for free in the same way
— Gemini gets it from one declarative TOML rule file, no hook needed.

## Open questions

1. ~~Does Gemini CLI have a hooks mechanism at all~~ **Resolved: yes**, inside `settings.json`'s
   `hooks` key, Claude-shaped (obeyed JSON control output), confirmed via the bundled hooks
   reference doc and the `hooks migrate --from-claude` subcommand. No further research needed here.
2. ~~Is there any Gemini CLI equivalent to Claude/Codex's on-demand skills model~~ **Resolved:
   yes**, `~/.gemini/skills/`, same `SKILL.md` convention, full CLI lifecycle. No further research
   needed here.
3. ~~Is the Policy Engine the right permissions target, and does it support a real 3-state `ask`~~
   **Resolved: yes to both.** `~/.gemini/policies/*.toml`, `decision = "allow"|"deny"|"ask_user"`,
   confirmed via the bundled `docs/reference/policy-engine.md`. The renderer's job becomes: write one
   or more `.toml` rule files into `~/.gemini/policies/`, each `[[rule]]` mapping one manifest
   behavior to `toolName`/`commandPrefix` + `decision` + `priority`. Unlike Codex, no
   `globals/system/hooks/gemini/permission-check.mjs`-equivalent runtime hook is needed to recover
   `ask` — the config layer already has it. Not yet exercised hands-on with a real rule file (no
   chat session run to confirm a written policy actually takes effect).
4. `--approval-mode yolo`/`plan` are full-autonomy and read-only modes with no roborepo equivalent
   on Claude or Codex. Out of scope to design roborepo controls for either in this plan — noted so
   they aren't silently assumed away, not because they need solving here.
5. The Policy Engine's Workspace (project-level) tier is currently non-functional per Gemini's own
   docs (their issue #18186) — only User (`~/.gemini/policies/`) and Admin (OS-specific system
   paths) tiers work. roborepo's permission model is inherently user/global-level anyway (it renders
   one manifest into each harness's *global* config), so this likely doesn't matter, but worth
   confirming in Phase 2 that nothing in the adapter design implicitly assumes a project-level
   override path exists for Gemini the way `.cursor/cli.json` vs `~/.cursor/cli-config.json` did for
   Cursor.

None of these block Phase 1's remaining work (writing the manifest) — all three permissions
questions (3-5) are now resolved enough to design Phase 2's permissions adapter with confidence.

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
- [x] Resolve Open question 3: read the bundled `docs/reference/policy-engine.md` and
  `bundle/policies/*.toml` examples. Confirmed the Policy Engine (`~/.gemini/policies/*.toml`) is
  the current target, not the deprecated `tools.allowed`/`tools.exclude` arrays, and that it has a
  real native `ask_user` decision — better native `ask` support than Codex, no runtime hook needed.
- [ ] If pursuing further hands-on verification, confirm `GEMINI.md` discovery/precedence and the
  `~/.gemini/commands/*.toml` format with a real authenticated session (requires Google auth, not
  needed for the manifest/adapter groundwork above).
- [x] Add `globals/harnesses/gemini/provider.json` following `provider-manifest.schema.json`:
  `detection.executables: ["gemini"]`, `detection.homeCandidates: ["~/.gemini"]`,
  `detection.configCandidates: ["~/.gemini/settings.json"]`, `paths` covering `home`, `rootConfig`,
  `rules`, `skills`, `commands`, plus a Gemini-specific `policies` path (`~/.gemini/policies`,
  directory — no Claude/Codex analog, same pattern as Codex's `rulesOverride`/`hooks` extra path
  entries) for the Policy Engine's rule-file directory. Declared the full verified capability set:
  `root-config`, `rules`, `permissions`, `skills`, `slash-commands`, `hooks`, `mcp` — deliberately
  omitted `package-config`/`telemetry-*`/`session-*`, since those were never researched or verified
  for Gemini and declaring them unverified would violate this plan's own "declare only what's
  confirmed" principle from Phase 1's first checklist item above. Validated directly against
  `validateProviderManifest` (`scripts/harnesses/contract.mjs`) before running any repo-wide check —
  passed clean on the first attempt.
- [x] Add Gemini manifest fixture: `scripts/test/fixtures/harnesses/valid-gemini.json` (identical to
  the real `provider.json`, matching the existing `valid-claude.json`/`valid-codex.json` pattern).
  Wired it into `scripts/test/harness-manifest-check.mjs`'s "real app-owned manifests must validate
  cleanly" block and its per-fixture capability-cross-check loop — the two places
  `valid-claude.json`/`valid-codex.json` were named explicitly; the check does not auto-discover
  fixture files by directory scan.
- [x] Confirmed `scripts/doctor.sh`'s `check_harness_manifests` and
  `scripts/test/harness-manifest-check.mjs` validate the new manifest without any change to either
  check's logic — `check_harness_manifests` directory-scans `globals/harnesses/*/provider.json`
  independent of the static adapter registry (`registry.mjs` only loads Claude/Codex via static
  imports; Gemini has no adapter yet, by design — that's Phase 2), so it picked up the new manifest
  automatically. This is the first real confirmation that Phase 1 of the original migration's schema
  work generalizes past two providers' worth of real-world shape, not just synthetic fixtures: 100/100
  doctor checks, 384/384 tests, both with zero code changes to either check.

## Phase 2: Adapter implementation

- [x] Add `scripts/harnesses/gemini/index.mjs` built via `defineHarnessProvider`. Implemented for
  real: `rootConfig` (plain-object deep merge + array dedupe, ported directly from Claude's
  `mergeObjects`/`mergeArrays` rule in `root-config-merge.mjs` — Gemini's settings.json shares that
  shape closely enough to reuse the rule rather than re-derive it), `permissions` (Policy Engine
  TOML render in the new `scripts/harnesses/gemini/policy-toml.mjs` — see below), `hooks.merge`/
  `hooks.unmerge` (settings.json's `hooks` key, reusing `hooks-merge.mjs`'s `isHooksMap`/
  `mergeHooksMap`/`unmergeHooksMap` unchanged — confirmed safe by reading the hook-definition shape
  in the installed package's `bundle/docs/hooks/reference.md`: `{matcher, sequential,
  hooks:[{type, command, name, timeout, description}]}` keys off the same `entry.hooks[0].command`
  identity Claude's hooks do), and `mcp.addServer`/`removeServer`/`list` (direct `mcpServers` JSON
  object read/write — no CLI shell-out needed, unlike Claude; confirmed shape via the real `gemini
  mcp add test-server echo hello --scope user` call from Phase 1, re-run again this phase to
  double-check: `{"mcpServers":{"test-server":{"command":"echo","args":["hello"]}}}`). `rules`,
  `skills`, `commands` (slash-commands), `hooks.read`/`write`, `mcp.add`/`remove` stay
  `stubAdapterGroups` placeholders — this matches the **current** bar for Claude and Codex too
  (both still stub these same methods; the real render/link logic for them hasn't migrated off
  `scripts/cli/*.mjs` for *any* provider yet, tracked as Phase 3-6 backlog on the parent
  `discoverable-harness-provider-architecture-plan.md`, not something specific to Gemini).
- [x] Tool-name mapping for `kind:"tools"` behaviors (the write-files behavior's Claude-specific
  `["Write","Edit"]` tool list) verified against the **installed package's own source constants**,
  not docs or a live session: `chunk-2NH5AG3B.js` in `@google/gemini-cli@0.53.1`'s bundle defines
  `WRITE_FILE_TOOL_NAME="write_file"`, `EDIT_TOOL_NAME="replace"`, `READ_FILE_TOOL_NAME="read_file"`
  as the complete, exhaustive set of file-write/read tool names Gemini ships (grepped every
  `*_TOOL_NAME` constant in the file — no other write-capable tool exists). This is stronger
  verification than a live session would give (a live session only samples the tools actually
  invoked in that run; the constants are the literal strings the Policy Engine matches against,
  ground truth from the binary itself). `kind:"network"` (Codex-only sandbox concept) renders
  nothing, same as `claudePermissions` skipping it.
- [x] Caught and fixed one real bug before it shipped: initial render emitted `decision = "ask"` for
  the manifest's `ask` bucket, but the Policy Engine's actual decision enum is
  `allow`/`deny`/`ask_user` (confirmed in `bundle/docs/reference/policy-engine.md` and every bundled
  example `.toml`) — `"ask"` is not a valid Gemini decision at all. Fixed via a `toGeminiDecision`
  mapping function in `policy-toml.mjs`; caught by manually inspecting a real render before writing
  any test, then pinned with an explicit characterization assertion
  (`testPermissionsAskMapsToAskUser`) so it can't silently regress.
- [x] Found and fixed a real registry-driven build-time bug while wiring Phase 2 in:
  `scripts/build/render-agent-permissions.mjs` (which is already generic over
  `listHarnessProviders()`, no hardcoded Claude/Codex list — this is exactly what the parent
  migration wanted proven) assumed every provider's permissions render target is its `rootConfig`
  file. True for Claude (settings.json) and Codex (config.toml), false for Gemini — Policy Engine
  rules live in a **directory** of standalone `*.toml` files with no rootConfig involvement at all.
  Fixed by branching on the manifest's own `extensions.roborepo.permissionsStorage ===
  "policy-engine-toml-directory"` signal (already present in the Phase 1 manifest) to compute
  `generated/gemini/policies/roborepo-permissions.toml` instead of `generated/gemini/settings.json`.
  Also had to add a `fs.mkdirSync(path.dirname(target), {recursive:true})` before the write —
  Claude/Codex never hit this because `generated/claude/` and `generated/codex/` already existed as
  committed directories; Gemini's nested `generated/gemini/policies/` subdirectory did not.
  `generated/gemini/policies/roborepo-permissions.toml` is now committed alongside
  `generated/claude/settings.json` and `generated/codex/config.toml` as the same kind of build
  artifact; `doctor.sh`'s existing `render-agent-permissions.mjs --check` run validates it with no
  further doctor changes, matching Phase 1's "check already generalizes" pattern.
- [x] Add characterization tests for the new adapter's render output, matching the style of
  `permissions-render-live-characterization-check.mjs` and `root-config-merge-characterization-check.mjs`:
  `scripts/test/gemini-adapter-characterization-check.mjs` (10 scenarios — rootConfig merge/render,
  the `ask`→`ask_user` decision mapping, the tools-kind→Gemini-tool-name mapping, network-kind skip,
  arbitrary-command rendering, permissions.render's `current`-independence, hooks merge/unmerge
  round-trip, mcp add/list/remove round-trip, mcp http-transport shape), wired into
  `test-roborepo.sh` next to the sibling harness-provider tests. Also updated
  `harness-registry-check.mjs`'s real-registry assertion from `providers.length === 2` to `=== 3`
  and added `gemini` to the `hasHarnessProvider` check — this test would otherwise have failed the
  moment Gemini was registered, since it hardcoded the pre-Gemini provider count.

## Phase 3: Consumer verification

- [x] Ran the full existing test suite and doctor with the Gemini provider manifest present but
  disabled (no test fixture or sandboxed HOME in the suite enables it by default — discovery-driven
  enablement only fires when `~/.gemini`/the `gemini` executable are actually present, per
  `scripts/harnesses/state.mjs`'s `applyDiscoveryToState`) — confirms zero-additional-provider-
  enabled behavior is unaffected, matching the "Zero detected providers leaves the RoboRepo CLI
  usable" validation criterion from the parent plan. 385/385 tests, 100/100 doctor checks, before
  any Phase 3 code changes.
- [x] Enabled Gemini in a sandboxed HOME (`~/.gemini/settings.json` seeded, `gemini` CLI genuinely
  on `PATH` from Phase 1's install) and ran the real proof-of-contract commands end to end:
  - `roborepo harness refresh`/`list`/`inspect gemini`: discovered as `confirmed` confidence
    (executable + home + config all present) — the highest of the three providers in this sandbox,
    since only `gemini` was actually installed on the test machine.
  - `roborepo update`: surfaced the `mergeRootConfig` crash below on first run; after the fix,
    completes cleanly (`updated root config claude`, `updated root config codex`, `added skill
    roborepo-support gemini`) — Gemini's own settings.json stays `{}` since `rootConfig.merge` has
    nothing to merge in yet (no repo-side `generated/gemini/settings.json` candidate exists —
    Gemini's generated candidate is the Policy Engine file, not a settings.json fragment).
  - `roborepo doctor --installed`: fails identically to Claude/Codex on the still-unmigrated `rules`
    capability (`GEMINI.md missing`, matching `CLAUDE.md missing`/`AGENTS.md missing`) — consistent,
    not a Gemini-specific regression, and expected per Phase 2's "rules/skills/commands stay stubbed"
    note. Gemini's skill symlink is *not* flagged as broken, confirming `skills.link`'s underlying
    mechanism (shared with Claude/Codex) worked correctly even though the capability itself is
    stubbed at the adapter layer.
  - `roborepo config rules check-home`: same expected `GEMINI.md missing` failure, consistent with
    Claude/Codex — registry-driven, uniform, not a crash.
  - `roborepo skill render-commands --check`: passes clean, but doesn't touch Gemini at all — no
    package currently declares a command resource targeting `gemini`, and the renderer itself is
    hardcoded to `.md` output (`scripts/cli/slash-commands.mjs`'s `renderPackageHarness`), which
    would be structurally wrong for Gemini's TOML format even if a package did. Confirmed this is
    exactly the already-scoped Phase 6 gap ("slash-command rendering: new format for the existing
    renderer, not just a new output path") — not a bug to fix now.
  - `roborepo mcp add test-server --harness gemini -- echo hello`: crashed (`mcpAdd` had no Gemini
    branch) until fixed below; after the fix, writes the correct `mcpServers` JSON shape, correctly
    reports "already present" on re-add, and correctly no-ops other harnesses' files.
  - `roborepo mcp add ... --dry-run` with no `--harness` filter: prints lines for all three
    providers now, matching the "selector appears for two or more relevant providers" pattern with
    three real providers instead of two.
- [x] Two real bugs found and fixed during the above (not the two originally logged in the parent
  plan's wrap-up-review section — those two, `package-harness-config.mjs`'s
  `applyPackageComponentResult` hardcoding `"codex"` and `mcp.mjs`'s bulk `mcpApply` only acting on
  claude/codex, are still open; see below):
  - **`scripts/cli/root-config-merge.mjs`'s `mergeRootConfig(harness, ...)` dispatcher** (hardcoded
    `if (harness === "codex") ...; if (harness === "claude") ...; throw`) crashed real
    `roborepo update` runs the moment Gemini was enabled — its two real callers,
    `scripts/cli/presets.mjs` and `scripts/cli/local-config-repair.mjs`, now dispatch through
    `getHarnessProvider(harness).adapters.rootConfig.merge` instead, which every registered
    provider (including Gemini's) already implements correctly. `local-config-repair.mjs`'s
    hardcoded `HARNESS_LABEL` map (`{claude: "...", codex: "..."}`) was fixed the same way, deriving
    the label from `manifest.displayName` instead. The CLI-entrypoint subprocess block (invoked by
    `install-lib.sh`'s `export_user_config`, the actual code path that crashed) now loads the
    registry dynamically too, inside an async IIFE — a bare top-level `await` inside a conditional
    left an unsettled-promise warning and a hung process in practice.
  - **`scripts/cli/permissions-render.mjs`'s `renderPermissionsTo`** (the live home-config path
    `config-mutate.mjs` calls on every behavior-bucket override change) only ever checked for
    `.claude` and `.codex` — Gemini's Policy Engine file never got created or updated at all, so a
    user changing a permission override through `roborepo`'s config controls would see the change
    reflected in Claude/Codex but silently never reach `~/.gemini/policies/`. Fixed by adding a
    third branch keyed off the manifest's own `permissionsStorage: "policy-engine-toml-directory"`
    extension hint, writing `~/.gemini/policies/roborepo-permissions.toml` whenever `~/.gemini/` is
    present (no Codex-style "don't fabricate" gate needed — Gemini fully owns this file, unlike
    Codex's shared config.toml).
  - **`scripts/cli/mcp.mjs`'s `mcpAdd`** only had `applyClaude`/`applyCodex` branches — despite
    `--harness gemini` already validating cleanly against the registry (the parsing layer,
    `mcp-parse.mjs`, was already fully generic), the execution layer silently did nothing for
    Gemini. Fixed by adding `ensureGeminiMcp` (direct `mcpServers` JSON read/write via the adapter's
    `addServer`, matching `ensureCodexMcp`'s shape) and wiring it into both the dry-run and
    real-write paths. Also fixed the command manifest's stale `--only-claude|--only-codex` usage
    text in `manifests/platform/cli/command-definitions/mcp/add.command.json` (the flag was
    replaced by repeatable `--harness <id>` well before this plan, but the static description/usage
    string was never updated).
  - Also fixed, while verifying the above: a real test fragility in `test-roborepo.sh`'s mcp-add
    block — on macOS `$TMPDIR` already ends in a slash, so
    `"${TMPDIR:-/tmp}/roborepo-test.XXXXXX"` produces a double-slash path that bash preserves
    literally in an exact-string `test =` assertion but Node normalizes away via `path.join` in its
    printed output. Only surfaced now because the new Gemini dry-run line is the first to embed a
    path in these particular assertions. Switched to `grep -Fq` substring checks (already this
    file's convention for other path-bearing output), pre-normalizing the embedded path with
    `tr -s /`.
  - Extended `permissions-render-live-characterization-check.mjs` and
    `mcp-add-characterization-check.mjs` with Gemini scenarios (policy file creation from nothing,
    override propagation independently verified through Gemini's own adapter, mcpServers
    add/list/remove round-trip, http-transport shape). Full suite after all fixes: 385 passed, 0
    failed.
- [ ] Revisit the two *still-open* follow-up items already logged in the parent plan's
  "Third-provider-readiness bugs found in wrap-up review" section: `package-harness-config.mjs`'s
  `applyPackageComponentResult` hardcoding `"codex"`, and `mcp.mjs`'s bulk `mcpApply` (package
  server sync, distinct from the single-server `mcpAdd` fixed above) only acting on claude/codex —
  `mcpApply` currently no-ops for Gemini correctly rather than crashing, since no package's
  `mcp-servers.json` entry declares `"gemini"` in its `harnesses` array yet (an authoring gap, not
  a code bug per se, but the dispatch logic itself is still hardcoded and needs the same
  registry-driven fix as `mcpAdd` before any package can target Gemini).
- [ ] Two more hardcoded-two-provider spots found while scoping Phase 2, still untriaged: six files
  with a literal `["claude", "codex"]` array outside the adapters/tests — `portal-usage.mjs`,
  `packages.mjs`, `telemetry.mjs`, `workspace-resources.mjs`, `package-probes.mjs`,
  `telemetry-schemas/snapshot-schema.mjs`. Not yet individually triaged for whether each is a real
  bug (silently drops Gemini) or an intentional two-provider-only scope.
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
