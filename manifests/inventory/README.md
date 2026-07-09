# manifests/inventory

The **supplied catalog** — the config items roborepo ships and fans out to the harnesses.
This is the place to *add things*. It is deliberately separate from `manifests/platform/`
(the install/verify/render plumbing) so adding an item can never accidentally disturb how
the installer wires `~/.claude` / `~/.codex`.

## Files

| File | What it holds | How to add an item |
| --- | --- | --- |
| `mcp-presets.json` | MCP server presets offered by `roborepo mcp add` | **Hand-edit.** No add command. `roborepo mcp add` *reads* a preset and writes it into live config; it never writes back here. |
| `agent-permissions.json` | Flat permission behaviors and arbitrary command buckets (`allow` / `ask` / `deny`) | **Hand-edit.** No add command. The renderer (`roborepo permissions`) reads the buckets and generates the `globals/*` blocks; it never writes back here. |
| `slash-commands.json` | Slash commands rendered into both harnesses | **`roborepo skill new`** appends + sorts + writes this for you. (Plain JSON, so hand-editing also works.) |
| `skill-invocation.json` | Per-skill risk / invocation policy | **`roborepo skill new`** appends + sorts + writes this for you. (Plain JSON, so hand-editing also works.) |
| `skill-trigger-tests.json` | Deterministic trigger and near-miss fixtures for medium-risk skills | **Hand-edit** when trigger policy changes, then run `roborepo skill triggers --check`. |

## Two ways an item lands here

- **CLI-written:** `slash-commands.json`, `skill-invocation.json` — added by
  `roborepo skill new` (see `scripts/cli/skill-new-manifests.mjs`).
- **Hand-edited:** `mcp-presets.json`, `agent-permissions.json`, `skill-trigger-tests.json` — no add command exists;
  open the file and add the entry, then run the consumer (`roborepo mcp add` /
  `roborepo permissions`, `roborepo skill triggers --check`) to use it.

After editing any file here, run `roborepo doctor` (and `roborepo permissions --check` /
`roborepo skill render-commands --check` for the rendered ones, plus
`roborepo skill triggers --check` after trigger fixture edits) to confirm nothing drifted.
