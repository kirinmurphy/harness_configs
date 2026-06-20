# Harness Parity Todo

Backlog of cross-harness parity work. Revised 2026-06-20 after native-alignment,
portable-install/repair, telemetry lifecycle, project-context, and the
skills-vs-commands control-plane manifests landed — several original items are now
done or have moved to dedicated plans. What remains here is the parity work those
efforts did **not** cover.

## Resolved Since This Doc Was Written

These were open items here and are now shipped — kept as a short ledger so the
backlog reads honestly.

- **Per-repo skill installer — DONE.** Exposed as `roborepo skill symlink-repo`
  (`scripts/cli/skills.mjs::skillLink` → `linkLocalSkills` in `skill-lib.mjs`).
  Symlinks a target repo's `.agents/skills` into its `.claude/skills` and/or
  `.codex/skills` without losing global skill parity. (Originally listed under the
  stale name `skill symlink-local`.)
- **Skill / plugin / MCP / memory native alignment — DONE** (see
  [`native-alignment.md`](native-alignment.md)).
  Skills now fan per-skill into each harness's native dir (`~/.claude/skills`,
  `~/.codex/skills`) instead of the invented `~/.agents` path; Claude MCP servers are
  version-controlled in `manifests/inventory/mcp-servers.json` and re-applied by
  `update`, symmetric with Codex; plugins are documented Claude-only; native memory is
  a documented Defer surface. This closed most of the "two source-of-truth stores"
  parity gaps that motivated this backlog.
- **Relocation / repair — DONE** (see
  [`completed/portable-install-relocation.md`](completed/portable-install-relocation.md)).
  `roborepo repair` relinks a moved checkout; uninstall and the bin-link heal handle
  stale prior-checkout links. This was part of the original "redesign the
  managed/adopt/update installer" item.
- **Placement of global coding conventions — RESOLVED.** Decision: conventions live
  in auto-invokable **helper skills** (`code-style`, `javascript-typescript`,
  `react`), not in always-on global rules. The candidate rule topics from the
  original item (named exports, helpers at file bottom, `function` for pure utilities,
  no procedural comments, constants over loose status strings, no emoji in UI) are
  covered by `globals/agents/skills/code-style/` and the language skills. The
  auto-vs-manual policy for these is governed by
  [`skills-vs-commands-invocation-policy.md`](skills-vs-commands-invocation-policy.md)
  and recorded in `manifests/inventory/skill-invocation.json`.

## Open Parity Work

### 1. Layered root-config inheritance (high priority — not yet started)

The largest remaining parity gap. Native-alignment aligned the *runtime stores*
(skills, MCP, plugins, memory); it did **not** touch how `~/.claude/settings.json`
and `~/.codex/config.toml` themselves are layered.

- **Current model:** read-mostly assets are symlinked into the harness homes; mutable
  root config is *exported* as a local file (`managed`) or left user-owned (`adopt`).
  There is no inheritance — the repo baseline and the user's machine-local config are
  one flat file, so a user edit and a repo update collide instead of layering.
- **Desired model:** repo provides a baseline; the user's global config can
  inherit / add / override it; repo-local context can overlay project-specific
  instructions where the harness supports it.
- **Research first:** whether Claude/Codex support native include / import / layering
  for root config. If not, design a generated/merged config with explicit source
  ownership and drift checks (the same ownership discipline native-alignment used for
  per-skill links).
- **Define interactions** with `managed`, `adopt`, `update`, `repair`,
  secrets / machine-local config, and repo-local `CLAUDE.md` / `AGENTS.md`.
- **Relationship to other plans:** this is the inheritance layer *underneath*
  [`managed-adopt-update-installer.md`](managed-adopt-update-installer.md); that plan
  owns the install-mode mechanics, this item owns whether config can layer at all.

### 2. Local-vs-global override policy (open decision)

How much should repo-local config override global behavior automatically versus by
explicit user opt-in? This is the policy half of item 1 — answer it as part of the
layering design rather than separately. It also overlaps the per-repo skill story
(`skill symlink-repo`), which already lets a repo add skills without overriding
global ones.

### 3. Stack-specific context shape (largely decided — confirm and close)

Original open question: should stack-specific context be skills, rules, or rules that
trigger skills? The de-facto answer is now **auto-invokable helper skills, gated by
description** (react, javascript-typescript, supabase-integration-testing, …), with
always-on rules reserved for short cross-cutting guidance. This is the operating
model of [`skills-vs-commands-invocation-policy.md`](skills-vs-commands-invocation-policy.md).
Remaining work is to *finish* that policy's control plane (trigger tests, the
skill-audit generator, and any manual-only rendering) rather than re-decide the
shape — track it there, not here.

## Cross-References

- [`native-alignment.md`](native-alignment.md) — runtime-store parity (skills, MCP,
  plugins, memory); complete.
- [`managed-adopt-update-installer.md`](managed-adopt-update-installer.md) —
  install-mode mechanics (managed / adopt / update); the consumer of item 1's
  layering design.
- [`skills-vs-commands-invocation-policy.md`](skills-vs-commands-invocation-policy.md)
  — how context (rules / skills / commands) enters each harness; owns item 3.
- [`completed/portable-install-relocation.md`](completed/portable-install-relocation.md)
  — relocation/repair, shipped.
