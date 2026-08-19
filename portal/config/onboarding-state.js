import { activePresentedHarnesses, supportedHarnessNames } from "../shared/harness-cohort.js";

export function configOnboardingNotice(snap) {
  const activeHarnesses = activePresentedHarnesses(snap);
  if (activeHarnesses.length === 0) {
    const supported = supportedHarnessNames(snap);
    return {
      variant: "warning",
      title: "No active agent harness detected.",
      body: supported
        ? `Package selections are saved, but no harness config is updated until you install or launch ${supported} and run roborepo harness refresh.`
        : "Package selections are saved, but no harness config is updated until you install or launch a supported harness and run roborepo harness refresh.",
    };
  }

  if (!hasOptionalPackageSelected(snap)) {
    const incomplete = snap?.onboarding?.libraryCompleted !== true;
    return {
      variant: "info",
      title: incomplete ? "Finish choosing optional packages." : "Add optional packages when ready.",
      body: incomplete
        ? "Choose optional packages below to extend your active harness config beyond the base setup."
        : "Your active harness has the base setup. Optional packages below can add telemetry, commands, workflow rules, and MCP-backed tools.",
    };
  }

  return null;
}

export function hasOptionalPackageSelected(snap) {
  return (snap?.packages || []).some((pkg) => pkg.enabled === true && pkg.defaultEnabled !== true);
}
