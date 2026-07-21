# Usage Statusline

Shows harness-provided usage signals in terminal footers without adding prompt context.

Claude Code uses its documented command-based `statusLine` setting. The formatter reads the JSON
payload from stdin and displays:

```text
Context: 42% · 5h: 18% · Weekly: 61%
```

Missing or unavailable values display `—`. Real zero values display `0%`.

Claude warning colors:

- default below 50%;
- orange from 50% through 69%;
- red at 70% and above.

Codex uses native `tui.status_line` fields only. RoboRepo does not patch the TUI, run a background
command, parse `/status`, parse transcripts, or call account endpoints.

Preview the Claude formatter:

```sh
echo '{"context_window":{"used_percentage":42},"rate_limits":{"five_hour":{"used_percentage":18},"seven_day":{"used_percentage":61}}}' \
  | node globals/packages/usage-statusline/scripts/claude-statusline.mjs
```
