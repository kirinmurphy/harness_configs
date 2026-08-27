## Validation Gates

Do not call work complete, ready to merge, ready to push, or CI-clean until the repository's own
completion gate has run and passed.

Use targeted checks while iterating. Before handoff or push, run the full local parity gate when the
change touches install/update/uninstall flows, package defaults, harness/provider config, generated
outputs, test orchestration, CI/workflows, or any cross-cutting behavior where a narrow check cannot
cover downstream effects.

If the full parity gate is too expensive or blocked, say that explicitly and report the exact
command not run. Do not substitute `doctor` or focused tests while still describing the work as
complete.
