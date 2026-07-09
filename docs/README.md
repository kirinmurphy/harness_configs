# RoboRepo Docs

Docs are organized by the question a reader is trying to answer. Use the table below to find the
doc of record first; supporting docs should add context, not redefine the behavior.

## Start Here

| I need to... | Start here | Then read |
| --- | --- | --- |
| Install roborepo on a machine | [First-Time Setup](guides/first-time-setup.md) | [Install Workflows](guides/install-workflows.md) |
| Use roborepo day to day | [Setup and Daily Use](guides/setup-and-daily-use.md) | [roborepo CLI Commands](reference/services/roborepo-cli.md) |
| Understand collision behavior | [Config Collision Handling](reference/internal/config-collision-handling.md) | [Install Workflows](guides/install-workflows.md) |
| Use the CLI | [roborepo CLI Commands](reference/services/roborepo-cli.md) | [roborepo CLI Reference](reference/services/roborepo.md) |
| Choose or inspect behavior packages | [Config Control Panel](reference/services/config-control-panel.md) | [Setup and Daily Use](guides/setup-and-daily-use.md) |

## Harness Architecture

| I need to... | Start here | Then read |
| --- | --- | --- |
| Understand why Claude and Codex parity has different mechanisms | [How the Harnesses Work](reference/internal/harnesses-explained.md) | [Cross-Harness Behavior Assessment](architecture/cross-harness-behavior-assessment.md) |
| Change a harness element | [Harness Anatomy and Parity](reference/internal/harness-anatomy.md) | [How It Works](reference/services/architecture.md) |
| Understand filesystem materialization | [How It Works](reference/services/architecture.md) | [Manifest And Materialization](architecture/manifest-and-symlinks.md) |
| Understand config vs. code boundaries | [Config-Code Separation](architecture/config-code-separation.md) | [Documentation Map And Audit](architecture/documentation-map-and-audit.md) |
| Understand rules generation | [Rules Parity and Layering](reference/internal/rules-parity-and-layering.md) | [Config Collision Handling](reference/internal/config-collision-handling.md#rendered-rules) |

## Feature Areas

| Area | Doc of record | Supporting docs |
| --- | --- | --- |
| Skills and slash commands | [Skills And Slash Commands](reference/internal/skills-and-commands.md) | [roborepo Skills Interface](reference/services/roborepo-skills.md) |
| Claude hooks | [Claude Hooks](reference/services/claude-hooks.md) | [Harness Anatomy and Parity](reference/internal/harness-anatomy.md#hooks) |
| Codex hooks | [Codex Hooks](reference/services/codex-hooks.md) | [Harness Anatomy and Parity](reference/internal/harness-anatomy.md#hooks) |
| Code indexing | [jcodemunch](reference/services/jcodemunch.md) | [roborepo CLI Commands](reference/services/roborepo-cli.md#index-code-and-docs) |
| Docs indexing | [jdocmunch](reference/services/jdocmunch.md) | [roborepo CLI Commands](reference/services/roborepo-cli.md#index-code-and-docs) |
| Convention capture | [Convention Capture](reference/services/convention-capture.md) | [Config Control Panel](reference/services/config-control-panel.md) |
| Inventory manifests | [Inventory Manifest README](../manifests/inventory/README.md) | [Config-Code Separation](architecture/config-code-separation.md) |

## Maintenance Notes

Use live reference docs for current behavior. Files under `docs/plans/` are working notes or
historical implementation records; they can explain why a decision happened, but they should not be
the only source for current behavior.

The current docs cleanup audit lives at
[Documentation Map And Audit](architecture/documentation-map-and-audit.md).
