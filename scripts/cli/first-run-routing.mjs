// Decides whether a bare `roborepo` invocation should enter the first-run workflow instead of the
// normal root menu. Kept as a pure function of (argv, phase, tty) so the policy is testable
// without a terminal and so main.mjs stays a composition root rather than a place where
// lifecycle rules accumulate.
//
// This is deliberately NOT the old onboarding gate. That gate blocked arbitrary commands until
// onboarding finished, which made the CLI unusable for anyone scripting against it. The rule here
// is narrow: only a bare invocation reroutes, and only in an interactive terminal. Every explicit
// command — including `doctor`, `version`, and `--help` — runs untouched no matter what the
// initialization record says, so a broken install can still be diagnosed.

import { initializationPhase } from "./initialization-state.mjs";

/**
 * @param {object} options
 * @param {string[]} options.args Post-flag-filtering argv
 * @param {"missing"|"in-progress"|"complete"} options.phase
 * @param {boolean} options.interactive
 * @returns {{route: "init"|"normal", reason: string}}
 */
export function resolveFirstRunRoute({ args, phase, interactive }) {
  if (args.length > 0) {
    return { route: "normal", reason: "explicit command given" };
  }
  if (!interactive) {
    // A bare non-interactive `roborepo` is almost always a script probing the CLI. Dropping it
    // into a wizard it cannot answer would hang the caller, so it gets the normal (help/menu)
    // path and the same exit behavior it had before initialization existed.
    return { route: "normal", reason: "not an interactive terminal" };
  }
  if (phase === "complete") {
    return { route: "normal", reason: "initialization already complete" };
  }
  return {
    route: "init",
    reason: phase === "missing" ? "initialization has never run" : "initialization was interrupted",
  };
}

export function shouldRouteToInit({
  args,
  phase = initializationPhase(),
  interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
} = {}) {
  return resolveFirstRunRoute({ args, phase, interactive }).route === "init";
}
