// Reports which skill references a captured session actually read.
//
// The rest of this plan makes required references harder to skip. This module answers the question
// that follows: did a session read them? A skill can declare a reference and an agent can still not
// open it, and until now the only available answer was to restate the requirement — which is not
// evidence of anything.
//
// How it works: telemetry capture already records every read-shaped tool call and stores the target
// as `file_path_hash`, an unsalted SHA-256 truncated to 24 characters. Because the hash is unsalted
// and derived only from the path string, a consumer that already knows a reference's path can hash
// it and test for its presence. That is the whole mechanism, and its limits are the point:
//
//   - It is a presence test against paths supplied by the caller. The pipeline cannot enumerate
//     what a session read; it can only confirm or deny paths it was already given. Plain-text paths
//     are never captured, and this module does not add any.
//   - Capture observes tool calls, not reasoning. A hit means the file was read, never that its
//     rules were applied. Nothing here should be described as compliance.
//   - A miss is weaker than a hit. The reference may have been read before capture was enabled, or
//     through a path this module did not think to try. Report "not observed", never "not read".
//
// The path root matters more than anything else here. Agents open these files through the
// harness-native skill directory (`~/.claude/skills/<name>/...`), which is a symlink to the roborepo
// cache (`~/.roborepo/skills/<name>/...`). Both name the same file, but they are different strings,
// and the hash is of the string. Verified against a real 3,622-read capture spool: the harness path
// matches and the cache path matches nothing at all. Hashing the wrong root would have produced a
// clean, confident, entirely empty report.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { privacyHash } from "./telemetry-schemas/hash.mjs";

// Harness skill directories, in the form an agent's own tool call would name. `~/.roborepo/skills`
// is deliberately absent: it is where the files live, not how they are opened, so hashes taken from
// it match nothing. Both harnesses are listed because either may have read the reference.
export function harnessSkillRoots(home = os.homedir()) {
  return [
    path.join(home, ".claude", "skills"),
    path.join(home, ".codex", "skills"),
  ];
}

// Every path a given skill reference might have been opened under. One reference yields one
// candidate per harness root, and a read through any of them counts.
export function referenceCandidatePaths(skill, reference, home = os.homedir()) {
  return harnessSkillRoots(home).map((root) => path.join(root, skill, reference));
}

// Builds the lookup a report is resolved against: hash -> { skill, reference }. Only paths handed in
// here can ever be reported on, which is what keeps the presence test from becoming path capture.
export function buildReferenceIndex(required, home = os.homedir()) {
  const index = new Map();
  for (const { skill, references } of required) {
    for (const reference of references) {
      for (const candidate of referenceCandidatePaths(skill, reference, home)) {
        index.set(privacyHash(candidate), { skill, reference });
      }
    }
  }
  return index;
}

// Resolves one session's captured events against the index.
//
// `events` are capture records as stored in the spool. `required` is [{ skill, references: [...] }]
// — the reference set the workflow declared. The result reports observed and unobserved separately
// rather than as a pass/fail, because only one of the two is evidence.
export function observedReferences(events, required, { home = os.homedir(), sessionId = null } = {}) {
  const index = buildReferenceIndex(required, home);
  const observed = new Map();
  let readEvents = 0;

  for (const event of events) {
    if (sessionId && event?.session_id !== sessionId) continue;
    const fileHash = event?.tool?.file_path_hash;
    if (!fileHash) continue;
    readEvents += 1;
    const match = index.get(fileHash);
    if (!match) continue;
    const key = `${match.skill}/${match.reference}`;
    if (!observed.has(key)) observed.set(key, { ...match, firstSeenAt: event.ts || null });
  }

  const expected = required.flatMap(({ skill, references }) =>
    references.map((reference) => ({ skill, reference, key: `${skill}/${reference}` })));

  return {
    // Reads the session made that carried a path at all. Zero here means the session captured no
    // reads — a different situation from reading the wrong things, and worth telling apart.
    readEvents,
    observed: expected.filter((item) => observed.has(item.key))
      .map((item) => ({ ...item, firstSeenAt: observed.get(item.key).firstSeenAt })),
    unobserved: expected.filter((item) => !observed.has(item.key)),
  };
}

// One-line-per-reference rendering. The wording is deliberate: an unmatched reference is "not
// observed", never "not read" — capture starting mid-session or a path this module did not try both
// produce a miss that says nothing about what the agent did.
export function renderReferenceReport(result) {
  const lines = [];
  for (const item of result.observed) lines.push(`read      ${item.skill}/${item.reference}`);
  for (const item of result.unobserved) lines.push(`not seen  ${item.skill}/${item.reference}`);
  if (!result.readEvents) {
    lines.push("");
    lines.push("No read events were captured for this session, so nothing above is evidence either way.");
  } else if (result.unobserved.length) {
    lines.push("");
    lines.push("\"not seen\" means no captured read matched that path — not that the reference went unread.");
  }
  return lines.join("\n");
}

// Convenience for callers that have a skill name and want its declared reference set without
// hand-maintaining a second copy: parses the mode/reference matrix out of the installed SKILL.md.
// Returns [] when the skill is not installed or its matrix does not parse, since a guess about what
// a skill requires is worse than reporting nothing.
export function declaredReferences(skill, mode, home = os.homedir()) {
  for (const root of harnessSkillRoots(home)) {
    const file = path.join(root, skill, "SKILL.md");
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const section = /For a named mode, read only the needed references:\n([\s\S]*?)\n\n/.exec(content);
    if (!section) return [];
    for (const bullet of section[1].split(/\n(?=- )/)) {
      const flat = bullet.replace(/\s+/g, " ").trim();
      const named = /^- `([a-z-]+)`[:,]/.exec(flat);
      if (!named || named[1] !== mode) continue;
      return [...new Set([...flat.matchAll(/references\/[a-z0-9-]+\.md/g)].map((match) => match[0]))];
    }
    return [];
  }
  return [];
}
