const FUTURE_PROVIDERS = ["docker", "processMetrics", "metadata"];

export function capabilityForPlatform(platform = process.platform) {
  const providers = providerCapabilitiesForPlatform(platform);
  const available = Object.values(providers)
    .filter((provider) => provider.state === "supported")
    .flatMap((provider) => provider.provides);
  const unavailable = Object.entries(providers)
    .filter(([, provider]) => provider.state !== "supported")
    .map(([name]) => name);
  if (platform === "darwin") {
    return {
      platform,
      platformLabel: "macOS",
      discovery: "supported",
      available,
      unavailable,
      providers,
      message: null,
    };
  }
  const label = platform === "win32" ? "Windows" : platform === "linux" ? "Linux" : platform;
  return {
    platform,
    platformLabel: label,
    discovery: "unsupported",
    available,
    unavailable,
    providers,
    message: `Automatic localhost discovery is not yet supported on ${label}.`,
  };
}

function providerCapabilitiesForPlatform(platform) {
  const coreState = platform === "darwin" ? "supported" : "unsupported";
  const coreMessage = platform === "darwin" ? null : "No listener adapter is implemented for this platform.";
  return {
    listeners: provider("listeners", coreState, ["listeners"], coreMessage),
    processWorkingDirectory: provider("processWorkingDirectory", coreState, ["processWorkingDirectory"], coreMessage),
    httpProbe: provider("httpProbe", coreState, ["httpProbe"], coreMessage),
    projectIdentity: provider("projectIdentity", coreState, ["projectIdentity"], coreMessage),
    // Git and history are gated on the same coreState as the rest: both are platform-neutral in
    // themselves, but nothing calls them where discovery is unsupported, and claiming support there
    // would put entries in `available` that no instance ever carries.
    git: provider("git", coreState, ["gitBranch", "gitCommit", "gitDirty", "gitAheadBehind"], coreMessage),
    history: provider("history", coreState, ["historyEvents"], coreMessage),
    ...Object.fromEntries(FUTURE_PROVIDERS.map((name) => [
      name,
      provider(name, "unsupported", [], "Planned in a follow-up Localhoster provider plan."),
    ])),
  };
}

function provider(name, state, provides, message = null) {
  return { name, state, provides, message, stale: false, lastSuccessAt: null, lastError: null };
}
