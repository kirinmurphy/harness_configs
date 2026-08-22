// Restores ~/.claude/settings.json from the backup install.mjs took, and verifies the probe is gone.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
const backupPath = path.join(here, 'settings.json.bak')

if (!fs.existsSync(backupPath)) {
  console.error(`no backup at ${backupPath} — nothing to restore`)
  process.exit(1)
}

fs.copyFileSync(backupPath, settingsPath)

const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
if (JSON.stringify(settings.hooks?.PostToolUse || []).includes('skill-observation-probe')) {
  console.error('RESTORE FAILED: the probe is still present in settings')
  process.exit(1)
}

fs.rmSync(backupPath)
fs.rmSync(path.join(here, 'fired.log'), { force: true })
console.log('settings restored, probe removed')
