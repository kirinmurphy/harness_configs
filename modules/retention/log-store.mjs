// Retention measurement for append-only JSONL logs: localhoster history, the telemetry spool,
// telemetry markers, and the dense-bash capture log.
//
// Measures and returns a verdict. Never writes — see policy.mjs for why the commit stays with each
// store.
//
// The gate below is the reason this module exists rather than each store calling dropCountForBytes
// directly. Retention almost never has anything to do, and finding that out must not cost a full
// read+parse of a 25MB file on every append. localhoster had this ladder; the spool did not, and
// stat'd then rewrote wholesale whenever it tripped.

import fs from "node:fs";
import { cutoffMillis, dropCountForBytes, dropVerdict, keepVerdict, normalizePolicy } from "./policy.mjs";

// Enough bytes to hold the first record of any store here. The largest measured record is the
// dense-bash log at ~604 bytes average, but a single long command can exceed that, so this is
// sized to read a generous first line rather than to a measured average.
const HEAD_PROBE_BYTES = 4096;

// Decide whether a log needs trimming, without reading it whole unless it does.
//
// Ladder, cheapest first:
//   1. stat            — below the floor, nothing is worth doing
//   2. cap check       — over the hard cap, skip straight to the full read
//   3. head probe      — parse only the oldest record; if it is inside the window, so is everything
//                        after it, because records are appended in time order
//   4. full read       — only now pay for parsing every line
export function measureLog({
  filePath,
  policy,
  now = new Date(),
  fsApi = fs,
  parseLine = defaultParseLine,
  timestampOf = defaultTimestampOf,
} = {}) {
  const resolved = normalizePolicy(policy);

  let size;
  try {
    size = fsApi.statSync(filePath).size;
  } catch {
    return keepVerdict("absent");
  }
  if (size === 0) return keepVerdict("empty");
  if (size <= resolved.floorBytes) return keepVerdict("below-floor");

  const overCap = resolved.maxBytes !== null && size > resolved.maxBytes;
  if (!overCap && !oldestRecordExpired({ filePath, resolved, now, fsApi, parseLine, timestampOf })) {
    return keepVerdict("within-policy");
  }

  return measureFully({ filePath, resolved, now, fsApi, parseLine, timestampOf });
}

// Full read: drop everything past the age window first, then trim to the byte cap if still over.
//
// Age runs first because it is the user-meaningful policy — a 14-day window means 14 days, and a
// size cap that pre-empted it would silently shorten the window on a busy machine. The cap is a
// backstop against pathological volume, not a second retention policy.
function measureFully({ filePath, resolved, now, fsApi, parseLine, timestampOf }) {
  let raw;
  try {
    raw = fsApi.readFileSync(filePath, "utf8");
  } catch {
    return keepVerdict("unreadable");
  }

  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const record = parseLine(line);
    // An unparseable line is still a line: it occupies bytes and sits at a position, so it must
    // count toward the byte math and be droppable. Only its timestamp is unknown.
    entries.push({ bytes: Buffer.byteLength(line, "utf8") + 1, at: record === null ? null : timestampOf(record) });
  }
  if (entries.length === 0) return keepVerdict("no-records");

  const cutoff = cutoffMillis(resolved, now);
  let dropped = 0;
  if (cutoff !== null) {
    // Records are appended in time order, so expiry is a prefix. Stop at the first live record
    // rather than filtering — a clock skew or hand-edited line further in must not strand
    // everything after it. A record with no parseable timestamp is treated as live.
    while (dropped < entries.length - 1) {
      const at = entries[dropped].at;
      if (at === null || at >= cutoff) break;
      dropped += 1;
    }
  }

  const remaining = entries.slice(dropped);
  const lengths = remaining.map((entry) => entry.bytes);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const byBytes = dropCountForBytes(lengths, total, resolved);

  const totalDropped = dropped + byBytes;
  if (totalDropped === 0) return keepVerdict("within-policy");
  return dropVerdict(totalDropped, dropped > 0 && byBytes > 0 ? "age-and-size" : dropped > 0 ? "age" : "size");
}

// Parse only the first line. Cheap enough to run on every append that clears the floor.
//
// Any failure returns true, routing to the full read. That is the safe direction: a corrupt or
// unreadable head means the fast path cannot prove the file is fine, and the full read will either
// fix it or bail on its own.
function oldestRecordExpired({ filePath, resolved, now, fsApi, parseLine, timestampOf }) {
  const cutoff = cutoffMillis(resolved, now);
  if (cutoff === null) return false;

  let head;
  try {
    const fd = fsApi.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(HEAD_PROBE_BYTES);
      const read = fsApi.readSync(fd, buffer, 0, HEAD_PROBE_BYTES, 0);
      head = buffer.subarray(0, read).toString("utf8").split("\n", 1)[0];
    } finally {
      fsApi.closeSync(fd);
    }
  } catch {
    return true;
  }

  const record = parseLine(head);
  if (record === null) return true;
  const at = timestampOf(record);
  if (at === null) return true;
  return at < cutoff;
}

function defaultParseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// Every store here stamps its records with an ISO string, but under different field names —
// localhoster uses `at`, telemetry capture uses `ts`. Both are checked so neither store needs a
// custom extractor for what is the same convention spelled two ways.
function defaultTimestampOf(record) {
  const raw = record?.at ?? record?.ts;
  if (typeof raw !== "string") return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
