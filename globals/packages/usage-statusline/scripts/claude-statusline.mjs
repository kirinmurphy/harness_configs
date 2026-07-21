#!/usr/bin/env node

export const ANSI = {
  orange: "\u001b[38;5;208m",
  red: "\u001b[91m",
  reset: "\u001b[0m",
};

export const THRESHOLDS = {
  percent: { orange: 50, red: 70 },
};

export function clamp(value) {
  return Math.min(100, Math.max(0, value));
}

export function normalizePercent(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(clamp(number)) : null;
}

export function toneForPercent(value) {
  if (value === null) return "default";
  if (value >= THRESHOLDS.percent.red) return "red";
  if (value >= THRESHOLDS.percent.orange) return "orange";
  return "default";
}

function metric(label, value) {
  const normalized = normalizePercent(value);
  return {
    label,
    value: normalized,
    text: `${label}: ${normalized === null ? "—" : `${normalized}%`}`,
    tone: toneForPercent(normalized),
  };
}

export function formatStatusLine(data, { color = !Object.hasOwn(process.env, "NO_COLOR") } = {}) {
  const metrics = [
    metric("Context", data?.context_window?.used_percentage),
    metric("5h", data?.rate_limits?.five_hour?.used_percentage),
    metric("Weekly", data?.rate_limits?.seven_day?.used_percentage),
  ];
  return metrics.map((entry) => colorSegment(entry, color)).join(" · ");
}

function colorSegment(entry, color) {
  if (!color || entry.tone === "default") return entry.text;
  return `${ANSI[entry.tone]}${entry.text}${ANSI.reset}`;
}

async function readStdin() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
}

async function main() {
  let data;
  try {
    data = JSON.parse(await readStdin());
  } catch {
    process.stderr.write("usage-statusline: invalid JSON input\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${formatStatusLine(data)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
