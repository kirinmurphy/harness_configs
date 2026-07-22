import fs from "node:fs";

// Incremental tail-read for append-only JSONL files (telemetry spool + harness transcripts). Both
// grow one newline-terminated line at a time and were each re-reading + re-parsing from byte 0 on
// every call — O(n) per call, O(n^2) over the file's life. This reads only the bytes appended since a
// caller-held byte offset and returns the complete lines in that range, so callers parse just what's
// new.
//
// Two subtleties both callers share, handled here once:
//   - Partial trailing line: a line still being written (no terminating "\n" yet) must NOT be parsed
//     or skipped. `nextOffset` is advanced only to the end of the last COMPLETE line, so the partial
//     is re-read whole on the next call once its newline lands.
//   - Shrink / rotation: if the file is now smaller than the caller's offset (e.g. the spool's
//     capSpool trim rewrites it smaller, or a transcript was rotated), the offset is meaningless —
//     `rebuilt: true` signals the caller to discard accumulated state and start from 0.
//
// Pure w.r.t. caller state: it holds no cursor itself. The caller owns the offset (in memory for the
// long-lived server; persisted to disk for the per-hook transcript reader) and how the lines are
// parsed/accumulated.

// Read newly-appended complete lines from `filePath` starting at byte `offset`.
// Returns:
//   { lines, nextOffset, rebuilt, ok }
//   - lines:      array of complete line strings in [effectiveOffset, lastNewline]; blanks dropped.
//   - nextOffset: byte offset just past the last complete line — pass this back next call.
//   - rebuilt:    true when the file shrank/rotated and the read restarted from 0 (caller should
//                 discard any state accumulated from earlier bytes of this file).
//   - ok:         false when the file is missing/unreadable (caller decides how to treat it);
//                 lines is empty and nextOffset echoes the requested offset in that case.
export function readAppendedLines(filePath, offset) {
  let size;
  let fd;
  try {
    size = fs.statSync(filePath).size;
    fd = fs.openSync(filePath, "r");
  } catch {
    return { lines: [], nextOffset: offset, rebuilt: false, ok: false };
  }
  // Shrink/rotation: the stored offset is past EOF, so it no longer points where we think — restart.
  const rebuilt = offset > size;
  const start = rebuilt ? 0 : offset;
  let chunk = "";
  try {
    if (size > start) {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      chunk = buf.toString("utf8");
    }
  } catch {
    fs.closeSync(fd);
    return { lines: [], nextOffset: offset, rebuilt: false, ok: false };
  } finally {
    fs.closeSync(fd);
  }

  // Advance only to the last complete line; hold back any unterminated trailing line for next call.
  const lastNewline = chunk.lastIndexOf("\n");
  if (lastNewline === -1) {
    // No complete line in the new bytes yet (a partial line still streaming). Don't advance.
    return { lines: [], nextOffset: start, rebuilt, ok: true };
  }
  const parseable = chunk.slice(0, lastNewline);
  const nextOffset = start + Buffer.byteLength(parseable, "utf8") + 1; // +1 for the newline
  const lines = [];
  for (const line of parseable.split("\n")) {
    if (line.trim()) lines.push(line);
  }
  return { lines, nextOffset, rebuilt, ok: true };
}
