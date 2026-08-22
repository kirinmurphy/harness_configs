// The one privacy hash used across the telemetry pipeline.
//
// Values that identify something the user did not agree to store in plain text — a file path, a
// repository remote, a shell command, a failure message — are recorded as this hash instead. It is
// deliberately unsalted, which is what makes a consumer able to hash a value it already knows and
// test whether a session touched it, without the pipeline ever being able to enumerate what it did
// not already have a candidate for.
//
// Consolidated from five independent copies. They were kept aligned by a comment, and a comment is
// a poor mechanism for this: changing the truncation width in one file does not fail anything. The
// hashes simply stop matching, every cross-file join returns zero rows, and zero rows is
// indistinguishable from "nothing happened". `telemetry-hash-check.mjs` pins the algorithm and
// width so that change fails loudly instead.
//
// Depends only on `node:crypto` on purpose. telemetry-capture.mjs runs on every PreToolUse and
// PostToolUse hook and documents a deliberate minimal-import constraint; this module is safe for it
// to import because it widens that import graph by nothing.
import { createHash } from "node:crypto";

// Truncation width in hex characters. 24 hex characters is 96 bits — far past collision risk at
// telemetry volumes, and short enough to keep JSONL lines small. Changing this invalidates every
// stored hash and silently breaks joins against existing captures.
export const PRIVACY_HASH_WIDTH = 24;

export function privacyHash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, PRIVACY_HASH_WIDTH);
}
