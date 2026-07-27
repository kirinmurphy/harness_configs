// Bounded append-only JSONL of Localhoster transition events.
//
// Events are written only when something CHANGES, not once per scan, so volume is tiny — a busy
// machine produces a few dozen lines a day. That is why this is one shared file rather than a file
// per app or per repository: sharding would multiply the fiddly parts (atomic compaction, retention,
// size capping) across shards, and per-app shards would orphan themselves anyway, since
// disambiguateAssociationKeys can swap an app's associationKey to its titleKey mid-life.
//
// stateRoot is a parameter rather than an import from scripts/cli/state-paths.mjs, matching
// settingsPathFor in settings.mjs. That parameterization is what makes this module testable against
// a temp directory with no environment juggling.

import fs from "node:fs";
import path from "node:path";

export const HISTORY_EVENT_VERSION = 1;
export const HISTORY_EVENT_TYPES = [
  "firstSeen",
  "originChange",
  "healthTransition",
  "exposureChange",
  "duplicateChange",
  "inactive",
];

export const HISTORY_MAX_BYTES = 2 * 1024 * 1024;
// Below this size, retention is not worth a full read on every append. The cap above is the hard
// safety net; this floor keeps the steady state at zero extra reads.
export const HISTORY_COMPACT_FLOOR_BYTES = 64 * 1024;
export const DEFAULT_RETENTION_DAYS = 14;

export function historyPathFor(stateRoot) {
  return path.join(stateRoot, "localhoster", "history.jsonl");
}

// Read every event, newest last. Unparseable lines are dropped silently, which is also how a
// truncated final line is tolerated: a partially-flushed last record simply fails JSON.parse and
// disappears until its newline lands.
//
// Deliberately NOT built on scripts/cli/jsonl-tail.mjs. readAppendedLines exists to make incremental
// tailing cheap for a long-lived reader that holds a byte cursor between calls (the telemetry spool).
// History is read whole, on demand, filtered by key — there is no cursor to hold, and inventing one
// to satisfy that signature would use the helper against its stated design.
export function readHistoryEvents({ stateRoot, fsApi = fs } = {}) {
  let raw;
  try {
    raw = fsApi.readFileSync(historyPathFor(stateRoot), "utf8");
  } catch {
    return [];
  }
  const events = [];
  for (const line of raw.split("\n")) {
    const event = parseEvent(line);
    if (event) events.push(event);
  }
  return events;
}

// Append a batch in a single write. This is the "in-memory write queue" the plan calls for: one
// refresh produces one array of events from diffSnapshots and flushes it in one syscall. A queue
// spanning refreshes would only add a flush-on-exit failure mode, since refreshes are already
// serialized by the inFlightRefresh guard in scripts/cli/localhoster.mjs.
//
// Never throws. History is an observability nicety; a full disk or a bad permission must not be able
// to break app discovery.
export function appendHistoryEvents(events, options = {}) {
  const { stateRoot, fsApi = fs, now = new Date(), retentionDays = DEFAULT_RETENTION_DAYS } = options;
  const valid = (events || []).filter(Boolean).map(normalizeEvent).filter(Boolean);
  if (!valid.length) return { written: 0, compacted: false };

  const filePath = historyPathFor(stateRoot);
  try {
    fsApi.mkdirSync(path.dirname(filePath), { recursive: true });
    fsApi.appendFileSync(filePath, valid.map((event) => JSON.stringify(event)).join("\n") + "\n");
  } catch {
    return { written: 0, compacted: false };
  }
  return { written: valid.length, compacted: maybeCompact({ stateRoot, fsApi, now, retentionDays }) };
}

// Drop events past the retention window, then trim to the size cap if still oversized. Retention
// runs first because it is the user-meaningful policy; the size cap is only a backstop against a
// pathological flapping app.
//
// The rewrite is atomic (temp file + rename, following writeRegistry in
// modules/repositories/registry.mjs). Do NOT copy capSpool's in-place writeFileSync from
// telemetry-capture.mjs — that is only safe because its reader detects the resulting shrink via byte
// offsets, which this reader has no way to notice.
export function compactHistory({
  stateRoot,
  fsApi = fs,
  now = new Date(),
  retentionDays = DEFAULT_RETENTION_DAYS,
} = {}) {
  const filePath = historyPathFor(stateRoot);
  const events = readHistoryEvents({ stateRoot, fsApi });
  if (!events.length) return false;

  const cutoff = toMillis(now) - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000;
  let kept = events.filter((event) => Date.parse(event.at) >= cutoff);

  let serialized = serialize(kept);
  while (kept.length > 1 && Buffer.byteLength(serialized, "utf8") > HISTORY_MAX_BYTES) {
    // Drop the oldest 30% at a time so a file that blew past the cap does not need one rewrite per
    // surplus line (mirrors SPOOL_KEEP_FRACTION's intent in telemetry-capture.mjs).
    kept = kept.slice(Math.max(1, Math.floor(kept.length * 0.3)));
    serialized = serialize(kept);
  }

  if (kept.length === events.length) return false;
  try {
    const dir = path.dirname(filePath);
    const temp = path.join(dir, `.history.${process.pid}.${Date.now()}.tmp`);
    fsApi.writeFileSync(temp, serialized);
    fsApi.renameSync(temp, filePath);
    return true;
  } catch {
    return false;
  }
}

function maybeCompact({ stateRoot, fsApi, now, retentionDays }) {
  let size = 0;
  try {
    size = fsApi.statSync(historyPathFor(stateRoot)).size;
  } catch {
    return false;
  }
  if (size <= HISTORY_COMPACT_FLOOR_BYTES) return false;
  return compactHistory({ stateRoot, fsApi, now, retentionDays });
}

function serialize(events) {
  return events.length ? events.map((event) => JSON.stringify(event)).join("\n") + "\n" : "";
}

function parseEvent(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  return normalizeEvent(parsed);
}

// Minimal shape validation so a hand-edited file cannot inject arbitrary objects into an API
// response. Anything missing the three fields that make an event addressable is dropped.
function normalizeEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at))) return null;
  if (!HISTORY_EVENT_TYPES.includes(event.type)) return null;
  if (typeof event.associationKey !== "string" || !event.associationKey) return null;
  return {
    v: HISTORY_EVENT_VERSION,
    at: event.at,
    type: event.type,
    associationKey: event.associationKey,
    projectIdentity: stringOrNull(event.projectIdentity),
    appId: stringOrNull(event.appId),
    repositoryId: stringOrNull(event.repositoryId),
    rootId: stringOrNull(event.rootId),
    from: event.from ?? null,
    to: event.to ?? null,
    reason: stringOrNull(event.reason),
  };
}

function stringOrNull(value) {
  return typeof value === "string" && value ? value : null;
}

function toMillis(now) {
  return now instanceof Date ? now.getTime() : new Date(now).getTime();
}
