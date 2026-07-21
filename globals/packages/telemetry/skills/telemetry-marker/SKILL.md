---
name: telemetry-marker
description: Use when the user wants to record a telemetry marker (change, phase, outcome, note) or start/end/check a telemetry experiment. Trigger on "mark this change", "start an experiment", "record telemetry marker", "/telemetry-marker".
---

# Telemetry Marker

Help the user create a meaningful `roborepo telemetry mark` or `roborepo telemetry experiment` event. The CLI is the source of truth — this skill only helps compose the call.

## Workflow

1. Determine marker type from context if not stated: `change` (implementation/configuration change), `phase` (task phase boundary), `outcome` (session/task result), `note` (freeform context). Experiment start/end use `telemetry experiment start|end`, not `telemetry mark` directly.
2. Ask the user only for intent that cannot be derived from the conversation — do not ask for repo, branch, SHA, or timestamp; the CLI resolves those automatically.
3. Propose a concise title (imperative, under ~60 chars) and confirm or let the user override it.
4. Associate likely `--package`/`--skill` values from files touched or packages discussed this session. Use "associated with" framing, never "caused by" — RoboRepo cannot measure causation.
5. Suggest a `--metric` id and `--expect increase|decrease|no-change` only when a concrete, measurable expectation exists. Skip both when there isn't one.
6. Invoke the CLI:

```bash
roborepo telemetry mark --type change --title "..." [--package <id>]... [--skill <id>]... [--metric <id>] [--expect increase|decrease|no-change] [--description "..."]
```

For experiments:

```bash
roborepo telemetry experiment start --title "..." --metric <id> --expect increase|decrease|no-change [--guardrail <id>]... [--minimum-sessions <n>]
roborepo telemetry experiment end <experiment-id>
roborepo telemetry experiment status [<experiment-id>]
```

7. Report the created marker/experiment ID back to the user, plus the resolved repo/branch/SHA/snapshot the CLI printed.

## Boundaries

- Never invent a metric or expected direction when none is evident.
- Never claim a package or skill caused a change — only that they were associated with it.
- A human can always create markers directly through the CLI without this skill.
