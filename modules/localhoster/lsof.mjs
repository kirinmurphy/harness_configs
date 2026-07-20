export function parseLsofFieldOutput(output) {
  const listeners = [];
  let processInfo = null;

  for (const raw of String(output || "").split(/\r?\n/)) {
    if (!raw) continue;
    const field = raw[0];
    const value = raw.slice(1);
    if (field === "p") {
      processInfo = { pid: Number(value), command: "" };
      continue;
    }
    if (!processInfo) continue;
    if (field === "c") {
      processInfo.command = value;
      continue;
    }
    if (field === "n") {
      const endpoint = parseEndpoint(value);
      if (!endpoint || endpoint.port === 0 || !Number.isInteger(processInfo.pid)) continue;
      listeners.push({
        pid: processInfo.pid,
        command: processInfo.command || "unknown",
        address: endpoint.address,
        port: endpoint.port,
        bindScope: bindScope(endpoint.address),
      });
    }
  }

  const seen = new Set();
  return listeners.filter((listener) => {
    const key = `${listener.pid}|${listener.address}|${listener.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseCwdFieldOutput(output) {
  for (const raw of String(output || "").split(/\r?\n/)) {
    if (raw.startsWith("n")) return raw.slice(1);
  }
  return null;
}

export function originCandidatesForListener(listener, preference = null) {
  const hosts = compatibleLoopbackHosts(listener.address);
  if (preference === "localhost" && hosts.includes("localhost")) {
    hosts.splice(hosts.indexOf("localhost"), 1);
    hosts.unshift("localhost");
  }
  return hosts.map((host) => ({
    protocol: "http",
    host,
    port: listener.port,
    origin: host === "::1" ? `http://[::1]:${listener.port}` : `http://${host}:${listener.port}`,
  }));
}

function parseEndpoint(value) {
  const trimmed = value.trim();
  const portMatch = trimmed.match(/:(\d+)(?:\s|\)|$)/);
  if (!portMatch) return null;
  const port = Number(portMatch[1]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return null;
  const beforePort = trimmed.slice(0, portMatch.index);
  const address = beforePort
    .replace(/^TCP\s+/i, "")
    .replace(/^\[|\]$/g, "")
    .replace(/\s+\(LISTEN\)$/i, "")
    || "*";
  return { address: normalizeAddress(address), port };
}

function normalizeAddress(address) {
  if (address === "*" || address === "0.0.0.0" || address === "::") return address;
  if (address === "localhost") return "localhost";
  if (address === "127.0.0.1" || address === "::1") return address;
  return address.replace(/^\[|\]$/g, "");
}

function bindScope(address) {
  if (address === "*" || address === "0.0.0.0" || address === "::") return "wildcard";
  if (address === "localhost" || address === "127.0.0.1" || address === "::1") return "loopback";
  return "network";
}

function compatibleLoopbackHosts(address) {
  if (address === "::1") return ["::1", "localhost"];
  if (address === "127.0.0.1") return ["127.0.0.1", "localhost"];
  if (address === "localhost") return ["localhost", "127.0.0.1", "::1"];
  if (address === "*" || address === "0.0.0.0" || address === "::") return ["localhost", "127.0.0.1", "::1"];
  return [];
}
