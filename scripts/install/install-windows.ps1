# install-windows.ps1 — Windows symlink installer for roborepo
#
# Requirements:
#   - Windows Developer Mode OR run PowerShell as Administrator
#     (symlink creation requires one of these)
#   - Git for Windows (https://git-scm.com) for hook scripts and bin/ commands
#     (hook scripts are bash — they will not run without Git Bash or WSL)
#
# Usage:
#   From PowerShell:  .\scripts\install\install-windows.ps1
#   From Git Bash:    called automatically by install/main.sh
#
# Less tested than macOS/Linux. Report issues or submit PRs.

param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$adoptRootConfig = @{
  claude = $false
  codex = $false
}

function Resolve-ManifestHomeRoot {
  param($HomeRoot)
  switch ($HomeRoot) {
    "claude" { return (Join-Path $env:APPDATA "Claude") }
    "codex"  { return (Join-Path $env:USERPROFILE ".codex") }
    default { throw "manifest: unknown home_root '$HomeRoot'" }
  }
}

function Get-ManifestRows {
  param([string[]]$Harnesses)
  $manifestPath = Join-Path $repoRoot "manifests/platform/manifest.tsv"
  if (-not (Test-Path $manifestPath)) {
    throw "missing manifest: $manifestPath"
  }

  foreach ($line in Get-Content $manifestPath) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
      continue
    }

    $cols = $line -split "`t", 6
    if ($cols.Count -ne 6) {
      throw "manifest: invalid row '$line'"
    }

    $harness = $cols[0]
    if ($Harnesses -and ($harness -notin $Harnesses)) {
      continue
    }

    $homeRoot = Resolve-ManifestHomeRoot $cols[4]
    [PSCustomObject]@{
      Harness = $harness
      Kind = $cols[1]
      RepoRel = $cols[2]
      HomePath = Join-Path $homeRoot $cols[3]
      Flags = $cols[5]
    }
  }
}

function Link-Item {
  param($RepoRel, $HomePath, [switch]$AllowReplace)
  $src = Join-Path $repoRoot $RepoRel

  if (-not (Test-Path $src)) {
    Write-Warning "missing source: $src"
    return
  }

  $parentDir = Split-Path -Parent $HomePath
  if (-not (Test-Path $parentDir)) {
    if ($DryRun) {
      Write-Host "would mkdir: $parentDir"
    } else {
      New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
    }
  }

  if (Test-Path $HomePath) {
    $existing = Get-Item $HomePath -Force
    if ($existing.LinkType -eq "SymbolicLink" -and $existing.Target -eq $src) {
      Write-Host "ok: $HomePath"
      return
    }
    if (-not $AllowReplace) {
      Write-Warning "conflict: $HomePath already exists; not replacing it"
      Write-AgentMergePrompt "install" "resolve local path conflict" $RepoRel $HomePath
      throw "install has non-root config conflicts; no replacement was made for $HomePath"
    }
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupRoot = Join-Path $env:USERPROFILE ".roborepo-backups\$timestamp"
    $backupPath = Join-Path $backupRoot $HomePath.TrimStart('\').TrimStart('/')
    if (-not $DryRun) {
      New-Item -ItemType Directory -Path (Split-Path -Parent $backupPath) -Force | Out-Null
      Move-Item -Path $HomePath -Destination $backupPath
    }
    Write-Host "backup: $HomePath -> $backupPath"
  }

  if ($DryRun) {
    Write-Host "link: $HomePath -> $src"
    return
  }

  try {
    New-Item -ItemType SymbolicLink -Path $HomePath -Target $src -Force | Out-Null
    Write-Host "link: $HomePath -> $src"
  } catch {
    Write-Warning "Failed to create symlink: $HomePath"
    Write-Warning "Enable Windows Developer Mode or run PowerShell as Administrator."
    Write-Warning "  Settings > System > For Developers > Developer Mode"
  }
}

function Remove-RepoLink {
  param($HomePath)

  $existing = Get-Item $HomePath -Force -ErrorAction SilentlyContinue
  if ($null -eq $existing -or $existing.LinkType -ne "SymbolicLink") {
    return
  }

  $target = [System.IO.Path]::GetFullPath($existing.Target)
  $root = [System.IO.Path]::GetFullPath($repoRoot)
  if (-not $target.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    return
  }

  if ($DryRun) {
    Write-Host "cleanup: $HomePath"
    return
  }

  Remove-Item $HomePath -Force
  Write-Host "cleanup: $HomePath"
}

function Write-AgentMergePrompt {
  param($Harness, $Mode, $RepoRel, $HomePath)
  $src = Join-Path $repoRoot $RepoRel
  Write-Host ""
  Write-Host "Merge review prompt:"
  Write-Host "-----"
  Write-Host @"
Compare harness config at:
  $src

With local user config at:
  $HomePath

Default stance: keep the local user config as source of truth. Preserve existing local behavior unless you can prove a harness change can be added safely.

Selected install direction: $Mode.

Required first step: compute your own complete comparison of both paths. Do not rely on this prompt as an exhaustive conflict summary. For directories, inspect the full recursive file list and content diffs. For structured files, parse the format when possible and identify all changed keys/tables/arrays/sections before editing.

Merge instructions:
- Keep local-only behavior by default.
- Add repo-only harness behavior only when it does not conflict with local behavior.
- If both sides edit the same setting, hook, rule, command, skill, or MCP/server entry, explain the conflict and stop for user choice.
- Do not delete, replace, or move the local path unless the user explicitly approves that exact action.
- Report the files changed and the conflicts left unresolved.
Harness: $Harness
"@
  Write-Host "-----"
  Write-Host ""
}

function Confirm-Choice {
  param($Prompt)
  $answer = Read-Host "$Prompt [Y/n]"
  return ($answer -eq "" -or $answer -eq "y" -or $answer -eq "Y" -or $answer -eq "yes" -or $answer -eq "YES")
}

function Export-UserConfig {
  param($Harness, $RepoRel, $HomePath)
  $src = Join-Path $repoRoot $RepoRel

  if (-not (Test-Path $src)) {
    Write-Warning "missing source: $src"
    return
  }

  if (Test-Path $HomePath) {
    $existing = Get-Item $HomePath -Force
    if ($existing.LinkType -eq "SymbolicLink" -and $existing.Target -eq $src) {
      if (-not $DryRun) {
        Remove-Item $HomePath
        Copy-Item $src $HomePath
      }
      Write-Host "copy: $HomePath <- $src (converted from repo symlink)"
      return
    }
    if ($existing.LinkType -ne "SymbolicLink" -and (Test-Path $HomePath -PathType Leaf)) {
      $srcHash = (Get-FileHash $src).Hash
      $homeHash = (Get-FileHash $HomePath).Hash
      if ($srcHash -eq $homeHash) {
        Write-Host "ok: $HomePath"
        return
      }
    }
  } else {
    if (-not $DryRun) {
      New-Item -ItemType Directory -Force -Path (Split-Path $HomePath) | Out-Null
      Copy-Item $src $HomePath
    }
    Write-Host "copy: $HomePath <- $src"
    return
  }

  if ($DryRun) {
    Write-Host "collision: $HomePath"
    Write-Host "dry-run: would ask whether to keep existing config or print merge prompt"
    return
  }

  if (-not [Environment]::UserInteractive) {
    throw "$HomePath exists and PowerShell is not interactive. Run interactively or use -DryRun to inspect collisions."
  }

  while ($true) {
    Write-Host ""
    Write-Host "User-owned $Harness config exists:"
    Write-Host "  local:   $HomePath"
    Write-Host "  harness: $src"
    Write-Host ""
    Write-Host "Choose:"
    Write-Host "  1) adopt         keep local root config; install only clean harness links"
    Write-Host "  2) merge prompt  print merge prompt; leave root config unchanged"
    Write-Host "  q) quit"
    $choice = Read-Host "Selection [1/2/q]"

    switch ($choice) {
      { $_ -in @("1", "adopt") } {
        Write-Host ""
        Write-Host "Keeping local $HomePath. Harness defaults will not be installed for this file."
        Write-AgentMergePrompt $Harness "adopt existing" $RepoRel $HomePath
        if (Confirm-Choice "Continue by adopting existing local config?") {
          Write-Host "skip: $HomePath left in place"
          return
        }
      }
      { $_ -in @("2", "agent", "prompt") } {
        Write-AgentMergePrompt $Harness "manual merge before install" $RepoRel $HomePath
        if (Confirm-Choice "Skip this root config export for now?") {
          Write-Host "skip: $HomePath left in place"
          return
        }
      }
      { $_ -in @("q", "Q", "quit", "exit") } {
        throw "install canceled by user"
      }
      default {
        Write-Host "Invalid selection."
      }
    }
  }
}

function Resolve-UserConfigCollision {
  param($Harness, $RepoRel, $HomePath)
  $src = Join-Path $repoRoot $RepoRel

  if (-not (Test-Path $src)) {
    Write-Warning "missing source: $src"
    return $false
  }

  if (Test-Path $HomePath) {
    $existing = Get-Item $HomePath -Force
    if ($existing.LinkType -eq "SymbolicLink" -and $existing.Target -eq $src) {
      return $false
    }
    if ($existing.LinkType -ne "SymbolicLink" -and (Test-Path $HomePath -PathType Leaf)) {
      $srcHash = (Get-FileHash $src).Hash
      $homeHash = (Get-FileHash $HomePath).Hash
      if ($srcHash -eq $homeHash) {
        return $false
      }
    }
  } else {
    return $false
  }

  if ($DryRun) {
    Write-Host "collision: $HomePath"
    Write-Host "dry-run: would ask whether to keep existing config or print merge prompt"
    return $false
  }

  if (-not [Environment]::UserInteractive) {
    throw "$HomePath exists and PowerShell is not interactive. Run interactively or use -DryRun to inspect collisions."
  }

  while ($true) {
    Write-Host ""
    Write-Host "User-owned $Harness config exists:"
    Write-Host "  local:   $HomePath"
    Write-Host "  harness: $src"
    Write-Host ""
    Write-Host "Choose:"
    Write-Host "  1) adopt         keep local root config; install only clean harness links"
    Write-Host "  2) merge prompt  print merge prompt; leave root config unchanged"
    Write-Host "  q) quit"
    $choice = Read-Host "Selection [1/2/q]"

    switch ($choice) {
      { $_ -in @("1", "adopt") } {
        Write-Host ""
        Write-Host "Keeping local $HomePath. Harness defaults will not be installed for this file."
        Write-AgentMergePrompt $Harness "adopt existing" $RepoRel $HomePath
        if (Confirm-Choice "Continue by adopting existing local config?") {
          Write-Host "skip: $HomePath left in place"
          return $true
        }
      }
      { $_ -in @("2", "agent", "prompt") } {
        Write-AgentMergePrompt $Harness "manual merge before install" $RepoRel $HomePath
        if (Confirm-Choice "Skip this root config export for now?") {
          Write-Host "skip: $HomePath left in place"
          return $true
        }
      }
      { $_ -in @("q", "Q", "quit", "exit") } {
        throw "install canceled by user"
      }
      default {
        Write-Host "Invalid selection."
      }
    }
  }
}

function Test-CleanTarget {
  param($RepoRel, $HomePath)
  $src = Join-Path $repoRoot $RepoRel

  if (-not (Test-Path $HomePath)) {
    return $true
  }

  $existing = Get-Item $HomePath -Force
  if ($existing.LinkType -eq "SymbolicLink" -and $existing.Target -eq $src) {
    return $true
  }

  Write-Warning "conflict: $HomePath already exists and is not managed by this repo."
  Write-AgentMergePrompt "install" "resolve local path conflict" $RepoRel $HomePath
  return $false
}

function Invoke-CleanTargetPreflight {
  $conflict = $false

  foreach ($row in Get-PresentManifestRows) {
    if ($row.Kind -ne "link") {
      continue
    }
    if (-not (Test-CleanTarget $row.RepoRel $row.HomePath)) {
      $conflict = $true
    }
  }

  if ($conflict) {
    throw "install has non-root config conflicts; no files were changed"
  }
}

function Invoke-RootConfigPreflight {
  $script:adoptRootConfig["claude"] = $false
  $script:adoptRootConfig["codex"] = $false

  foreach ($row in Get-PresentManifestRows) {
    if ($row.Kind -ne "root_config") {
      continue
    }
    if (Resolve-UserConfigCollision $row.Harness $row.RepoRel $row.HomePath) {
      $script:adoptRootConfig[$row.Harness] = $true
    }
  }
}

function Get-PresentHarnesses {
  $harnesses = @()
  if ($hasClaude) {
    $harnesses += "claude"
  }
  if ($hasCodex) {
    $harnesses += "codex"
  }
  return $harnesses
}

function Get-PresentManifestRows {
  return Get-ManifestRows (Get-PresentHarnesses)
}

function Link-GlobalSkills {
  param($HomeDir)
  $srcDir = Join-Path $repoRoot "globals\agents\skills"
  $skillsHome = Join-Path $HomeDir "skills"

  if (-not (Test-Path $srcDir)) { return }

  Get-ChildItem $srcDir -Directory | ForEach-Object {
    $name = $_.Name
    if ($name.StartsWith(".")) { return }
    $skillMd = Join-Path $srcDir "$name\SKILL.md"
    if (-not (Test-Path $skillMd)) { return }
    if ($_.LinkType -eq "SymbolicLink") { return }  # skip symlinked source dirs

    $target = Join-Path $skillsHome $name
    $src = Join-Path $srcDir $name

    if (Test-Path $target) {
      $existing = Get-Item $target -Force
      if ($existing.LinkType -eq "SymbolicLink" -and $existing.Target -eq $src) {
        Write-Host "ok: $target"
        return
      }
      if ($existing.LinkType -ne "SymbolicLink") {
        Write-Host "skip (native skill): $target"
        return
      }
    }

    if (-not (Test-Path $skillsHome)) {
      if (-not $DryRun) { New-Item -ItemType Directory -Path $skillsHome -Force | Out-Null }
    }

    if ($DryRun) {
      Write-Host "link: $target -> $src"
      return
    }

    try {
      New-Item -ItemType SymbolicLink -Path $target -Target $src -Force | Out-Null
      Write-Host "link: $target -> $src"
    } catch {
      Write-Warning "Failed to create skill symlink: $target"
      Write-Warning "Enable Windows Developer Mode or run PowerShell as Administrator."
    }
  }
}

function Invoke-ManifestRows {
  param($HarnessLabel, [string[]]$Harnesses)

  Write-Host ""
  Write-Host "--- $HarnessLabel ---"
  foreach ($row in Get-ManifestRows $Harnesses) {
    switch ($row.Kind) {
      "root_config" {
        if (-not $adoptRootConfig[$row.Harness]) {
          Export-UserConfig $row.Harness $row.RepoRel $row.HomePath
        }
      }
      "link" {
        Link-Item $row.RepoRel $row.HomePath
      }
      "cleanup" {
        Remove-RepoLink $row.HomePath
      }
    }
  }
}

# Detect which harnesses are present
$hasClaude = Test-Path (Join-Path $env:APPDATA "Claude")
$hasCodex  = Test-Path (Join-Path $env:USERPROFILE ".codex")

if (-not $hasClaude -and -not $hasCodex) {
  Write-Warning "Neither Claude Code (~AppData\Roaming\Claude) nor Codex (~\.codex) found."
  Write-Warning "Install Claude Code or Codex first, then re-run this script."
  exit 1
}

Invoke-CleanTargetPreflight
Invoke-RootConfigPreflight

# Claude managed links, root config export, and per-skill links
if ($hasClaude) {
  Invoke-ManifestRows "Claude" @("claude")
  $claudeHome = Resolve-ManifestHomeRoot "claude"
  Link-GlobalSkills $claudeHome
} else {
  Write-Host "skip: Claude — AppData\Roaming\Claude not found"
}

# Codex managed links, root config export, and per-skill links
if ($hasCodex) {
  Invoke-ManifestRows "Codex" @("codex")
  $codexHome = Resolve-ManifestHomeRoot "codex"
  Link-GlobalSkills $codexHome
} else {
  Write-Host "skip: Codex — ~/.codex not found"
}

# Post-install summary
Write-Host ""
Write-Host "Install complete."
Write-Host "  Claude: $(if ($hasClaude) { 'linked' } else { 'skipped — not installed' })"
Write-Host "  Codex:  $(if ($hasCodex)  { 'linked' } else { 'skipped — not installed' })"
Write-Host ""
Write-Host "IMPORTANT: Hook scripts and bin/ commands require bash."
Write-Host "  Install Git for Windows: https://git-scm.com"
Write-Host "  Then add $(Join-Path $repoRoot 'bin') to your PATH or run install-global-commands.sh from Git Bash."
Write-Host ""
Write-Host "To add a harness later: install it, then re-run this script."
