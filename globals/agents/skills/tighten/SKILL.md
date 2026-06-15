---
name: tighten
description: Use ONLY when the user explicitly asks to tighten, clean up, or harden code against this project's own patterns and conventions — via the `/tighten` command or a clear instruction like "tighten this" or "clean this up against our patterns". Improves implementation quality without changing intended UX, producing specific, project-anchored callouts (cite the exact pattern, path, or rule) rather than generic cleanup advice. Pulls Project Context inventory facts when present and offers to generate them when missing. Do not auto-invoke for ordinary edits, do not trigger on the mere presence of code, and do not change product behavior unless the user asks.
---

# Tighten

Tighten improves implementation quality while preserving the intended product experience. It is
the project-aware counterpart to a generic cleanup pass: every finding must be **specific** —
naming the exact pattern, path, rule, or risk — not a generic "reduce duplication". It runs only
when the user explicitly asks.

## Inputs (in priority order)

1. **`code-style` skill** — general cross-language conventions (naming, file organization,
   helper placement, comments, exports, repetition, readability). Load it.
2. **`javascript-typescript` / `react` skills** — load when the touched files are JS/TS or React.
3. **Project Context inventory** (`docs/project-context/generated/repo-scan.json` and the curated
   `inventory.md` / `glossary.md`) — the project's own reusable surfaces, patterns, and risk
   areas. Use it to anchor findings to real code.
4. **The surrounding code itself** — always verify a finding against the actual code before
   reporting it.

## Inventory Handling

Tighten is better with inventory facts, but does not require them.

- If inventory facts exist, read them and anchor findings to the documented patterns/surfaces.
- If they are missing and the user invoked tighten explicitly, **ask** whether to run
  `roborepo project-context inventory` first (it is like indexing the code — cheap, deterministic,
  improves specificity). Do not run it silently.
- If the user declines, proceed using `code-style` + direct code inspection.

## Loop

1. Identify the scope: the user's named files/area, else the current diff/changed files.
2. Load `code-style` (+ `javascript-typescript` / `react` as the files require) and the inventory.
3. Review the scope against those inputs. For each issue, produce a **specific** callout:
   - what: the exact problem, with `path:line`.
   - rule/pattern: which convention or documented pattern it violates, by name.
   - fix: the concrete change, referencing the existing example to copy when one exists.
   - risk: low / medium / high, and best timing.
4. Apply high- and medium-risk fixes that do not change UX. Leave low-risk items as notes.
5. Review again; repeat until only low-priority items remain or three passes are done.
6. Summarize what changed and what remains.

## Specificity Rule

Never emit a generic finding. Each callout must cite something concrete in *this* repo.

- Bad: "reduce repeated code".
- Good: "`src/checkout/total.ts:40` re-implements the discount math already in
  `src/pricing/discount.ts:12` (`applyDiscount`); call the existing helper. Medium risk —
  covered by `pricing.test.ts`."

## What Tighten Must Not Do

- Do not change intended UX or product behavior unless the user explicitly asks.
- Do not turn every low-risk cleanup into immediate work; report and let the user choose.
- Do not auto-run inventory or restructure docs.
- Do not run unless explicitly invoked.

## Risk Checkpoints

Take extra care, and state what to verify, when tightening touches: authentication;
authorization/ownership/admin; database schema and migrations; API behavior and mutations;
environment variables and deployment config; file uploads and storage; external integrations.
