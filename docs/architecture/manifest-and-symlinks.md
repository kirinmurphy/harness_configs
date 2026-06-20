# Manifest & Symlink Model

How roborepo gets its version-controlled config from the repo into a user's harness homes
(`~/.claude`, `~/.codex`), and how every script agrees on what is managed.

## The one-sentence version

The repo holds the real files under `globals/`; the install scripts create **symlinks** in
your home harness dirs that point back at them; and a single data file —
`manifests/platform/manifest.tsv` — is the **one list** every script reads to know what to link, verify,
or clean up.

## Glossary

Grouped by the kind of thing each term names.

### Places (where config lives)

| Term | Meaning |
| --- | --- |
| **harness** | An agent runtime that reads config from a home dir. Here: **Claude** (`~/.claude`) and **Codex** (`~/.codex`). |
| **globals/** | Repo dir holding the real, version-controlled config meant to go global. Subdirs: `claude/`, `codex/`, `agents/`, `rules/`. |
| **harness home** | The per-harness config dir in `$HOME`: `~/.claude`, `~/.codex`. |

### Data files (the lists, and who reads them)

| Term | Meaning |
| --- | --- |
| **manifest** | `manifests/platform/manifest.tsv` — the single list of managed home↔repo paths. An inventory: *these things are managed, and how.* |
| **source-files list** | `manifests/platform/source-files.tsv` — separate checklist of repo files that must exist (asserted by doctor). Tracks repo health, not home symlinks. |
| **Bash reader** | `scripts/lib/manifests-data.sh` — bash funcs (`manifest_rows`, `source_files`) that parse the data files so POSIX scripts do not hardcode the list. |
| **PowerShell reader** | `scripts/install/install-windows.ps1` — parses `manifests/platform/manifest.tsv` directly for Windows installs. |
| **consumer** | A script that reads the manifest: `main.sh`, `install-claude.sh`, `install-codex.sh`, `install-windows.ps1`, `verify-install.sh`, `doctor.sh`, `sync-from-home.sh`. |

### Manifest row vocabulary (what a row says)

| Term | Meaning |
| --- | --- |
| **row kind** | What a row *does*: `link`, `root_config`, or `cleanup`. |
| **`link`** | Clean symlink: `~/.harness/<sub>` → `repo/globals/...`. Repo is source of truth. |
| **`root_config`** | Mutable user state (`settings.json`, `config.toml`). **Copied**, not linked; left in place on collision ("adopt"). User owns it. |
| **`cleanup`** | A path roborepo *used* to manage. Install **prunes** the old repo-symlink there; never re-created. `src_rel` is `-`. |
| **flag `nodoctor`** | Row is checked by `verify-install.sh` but intentionally **not** by `doctor --installed`. |
| **flag `nosync`** | Row is skipped by `sync-from-home.sh` (e.g. skills — maintained in-repo and symlinked outward, never pulled back). |

### Behaviors (verbs the installer performs)

| Term | Meaning |
| --- | --- |
| **adopt** | "Keep the local file, don't overwrite." Triggered on a `root_config` collision, or pre-declared via `HARNESS_ADOPT_<HARNESS>_CONFIG=1` for unattended runs. |
| **prune** | Remove a retired repo-symlink from a home path (the action a `cleanup` row drives), backing it up first. |

## How a managed file flows from repo to home

The example below uses one Claude file (`CLAUDE.md`), but the flow is identical for **every
`link` row of every harness** — `~/.codex/AGENTS.md`, etc. all work the same way: real file
in `globals/`, symlink in the home dir, agent reads the symlink.

```mermaid
flowchart LR
  subgraph repo["repo: globals/"]
    src["globals/claude/CLAUDE.md<br/>(real file)"]
  end
  subgraph manifest["manifests/platform/manifest.tsv"]
    row["row: claude | link |<br/>globals/claude/CLAUDE.md |<br/>CLAUDE.md | claude"]
  end
  subgraph home["harness home"]
    link["~/.claude/CLAUDE.md<br/>(symlink)"]
  end
  claude["Claude reads<br/>~/.claude/CLAUDE.md"]

  row -- "tells installer what to link" --> link
  link -- "symlink target" --> src
  claude --> link
```

The agent reads its home dir; the home dir is a symlink; the symlink resolves to the real
repo file. Edit the repo file → every harness sees the change with no re-copy.

## One manifest, many consumers

Before this model, the same home↔repo list was hand-copied across 7+ scripts. Change one,
forget another, and they drift. Now they all read one file:

```mermaid
flowchart TD
  tsv["manifests/platform/manifest.tsv<br/>(single source of truth)"]
  reader["scripts/lib/manifests-data.sh<br/>manifest_rows()"]
  tsv --> reader

  reader --> main["install/main.sh<br/>preflight"]
  reader --> ic["install-claude.sh<br/>link + adopt + cleanup"]
  reader --> icx["install-codex.sh<br/>link + adopt + cleanup"]
  reader --> verify["verify-install.sh<br/>check links exist"]
  reader --> doctor["doctor.sh --installed<br/>check links + guard"]
  reader --> sync["sync-from-home.sh<br/>(reverse: home → repo)"]
  tsv --> win["install-windows.ps1<br/>PowerShell reader"]

  doctor --> guard["check_manifest_sources:<br/>every src_rel must exist"]
```

`check_manifest_sources` (in doctor) is the **drift guard**: if a row names a repo file that
was renamed or deleted, doctor fails loudly instead of the installer silently skipping it.

The PowerShell installer does not source the bash reader. It parses the same TSV file itself,
then applies the same row kinds: `link`, `root_config`, and `cleanup`. That keeps Windows off
the old hand-copied path list without making PowerShell depend on a POSIX shell.

## Row kind → behavior

```mermaid
flowchart TD
  row["manifest row"]
  row --> k{"kind?"}
  k -->|link| L["symlink home → repo<br/>(repo is truth)"]
  k -->|root_config| R["copy to home,<br/>adopt-on-collision<br/>(user owns it)"]
  k -->|cleanup| C["prune stale repo-symlink<br/>at home (never re-create)"]

  L --> f{"flag?"}
  f -->|nodoctor| nd["verify checks it,<br/>doctor skips"]
  f -->|nosync| ns["sync-from-home skips it<br/>(e.g. skills)"]
  f -->|none| nn["checked / synced everywhere"]
```

## The skills layout

roborepo manages shared skills via `globals/agents/skills/<name>/SKILL.md` in version control.
At install time, per-skill symlinks are created in **each harness's native skills dir**:
`~/.claude/skills/<name>` and `~/.codex/skills/<name>` both point into the repo source.

```mermaid
flowchart LR
  agsrc["repo: globals/agents/skills/&lt;name&gt;<br/>(canonical source)"]
  claudesk["~/.claude/skills/&lt;name&gt;<br/>(managed per-skill symlink)"]
  codexsk["~/.codex/skills/&lt;name&gt;<br/>(managed per-skill symlink)"]
  nativetool["Codex native skill tools<br/>(init_skill.py / skill-installer)"]
  nativesk["~/.codex/skills/&lt;other-name&gt;<br/>(unmanaged, native-installed)"]

  claudesk -- "symlink" --> agsrc
  codexsk -- "symlink" --> agsrc
  nativetool -- "writes" --> nativesk
```

Skills are not manifest rows — they are linked by an **enumerate-step** in the installer
(`install-lib.sh:link_global_skills`), called by `install-claude.sh` and `install-codex.sh`
after the manifest rows. This keeps the manifest focused on static paths while skills grow
dynamically.

### Ownership boundary

roborepo manages only the skill names it owns. Native-installed skills (created via
`init_skill.py` or `skill-installer` directly) land at unrecognized names and are left
untouched. `roborepo doctor --installed` and the SessionStart hook report them as drift;
`roborepo skill adopt <name>` moves them into version control.

## Related

- `docs/architecture/config-code-separation.md` — simple breakdown of what belongs in
  config versus code, plus remaining extraction candidates.
- `docs/plans/sync-from-home-manifest.md` — history of the `sync-from-home.sh` manifest
  migration (now done), the `blocklist.json` decision it resolved, and the FD-3 interactive
  prompt gotcha.
- `docs/reference/services/architecture.md` — broader repo/install architecture.
