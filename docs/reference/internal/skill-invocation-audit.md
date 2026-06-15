# Skill Invocation Audit

> **Status: BASELINE.** Current shared-skill inventory for the invocation policy.
> This is not a behavior change. It records what should stay auto-invokable for
> now, what needs tighter triggers, and what would require manual-only controls
> before future conversion.

## Compatibility Result

Claude and Codex both support manual-only skills, but the settings live in
different places.

| Harness | Manual-only setting | Source |
| --- | --- | --- |
| Claude | `disable-model-invocation: true` | `SKILL.md` frontmatter |
| Codex | `policy.allow_implicit_invocation: false` | `agents/openai.yaml` |

Policy implication: do not put Claude-only manual invocation fields into shared
skill frontmatter as the source of truth. Use a shared manifest or generated
checks if this repo starts converting skills to manual-only behavior.

## Current Shared Skills

| Skill | Current trigger quality | Risk if auto-loaded | Recommendation |
| --- | --- | --- | --- |
| `blog` | Medium: good workflow trigger, but broad writing-language matches can be ambiguous | Medium | Keep auto for now; tighten skip cases; later split `/blog-mode` from one-shot blog actions if needed |
| `code-style` | Good: cross-language convention work | Low | Keep auto |
| `frontend-design` | Medium: valuable but broad "build UI" trigger can reshape product tone | Medium | Keep auto for now; tighten trigger and skip cases |
| `javascript-typescript` | Good: language and file-type gated | Low | Keep auto |
| `project-context` | Explicit-only: gated to the `/inventory` command and clear instructions | Medium | Manual entry via `/inventory`; description forbids auto-invoke on keyword overlap |
| `react` | Good: framework and file-type gated | Low | Keep auto |
| `roborepo-support` | Good: repo/path/task gated | Low to medium | Keep auto for this repo; keep trigger narrow |
| `supabase-integration-testing` | Good: already requires most conditions to match | Low to medium | Keep auto |
| `technical-planning-docs` | Medium: useful for real docs, but can over-structure quick planning requests | Medium | Keep auto for now; tighten trigger and skip cases |
| `test-harness` | Good: verification and test-design gated | Low | Keep auto |
| `tighten` | Explicit-only: gated to the `/tighten` command and clear instructions | Medium | Manual entry via `/tighten`; must not fire on ordinary edits or the mere presence of code |

## Dynamic Context And Shell Audit

Shared skills should be scanned for:

- `!` dynamic context in Markdown
- fenced dynamic shell blocks
- `allowed-tools` or broad tool-grant frontmatter
- scripts that run without clear user intent

Current policy:

- Low-risk skills can remain auto-invokable when they are instruction-only.
- Dynamic shell context requires explicit trust review.
- Side-effecting workflows such as commit, deploy, release, and handoff should
  be manual commands or hooks, not auto-invokable skills.

## Next Actions

1. Tighten medium-risk skill descriptions: `blog`, `frontend-design`,
   `technical-planning-docs`.
2. Add a simple audit/check that can regenerate this inventory from skill
   metadata.
3. Add trigger tests for expected matches and near misses.
4. Introduce a shared invocation manifest only when the repo is ready to render
   harness-specific manual-only controls.
