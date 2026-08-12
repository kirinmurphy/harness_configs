## Codex Specifics

- Stable global Codex config is version-controlled in this repo.
- Prefer editing tracked repo files instead of adding ad hoc files under `~/.codex`.
- If useful config is added directly under `~/.codex`, capture it in the repo or update `scripts/sync-from-home.sh` / `scripts/install/main.sh`.
- In restricted Codex sandboxes, npm commands can fail writing `~/.npm/_logs`, and localhost tests can fail binding `127.0.0.1`; if that exact behavior blocks required verification, rerun once with escalation instead of repeating sandbox attempts.
