// Derive transition events by comparing two consecutive snapshots.
//
// This lives in the module layer rather than inline in scripts/cli/localhoster.mjs because the
// comparison rules ARE the event semantics — six types, each with its own definition of "changed".
// As a pure function it is testable against two literal snapshot objects; inlined next to the
// lastSnapshot reference it could only be exercised by stubbing the entire discovery pipeline.
//
// Instances are matched by associationKey, which is port-free and PID-free (see buildMatchSignature
// in instance-shape.mjs). An app that restarts on a new port is therefore the SAME app here, and
// produces an originChange rather than a spurious inactive + firstSeen pair.

import { HISTORY_EVENT_VERSION } from "./history.mjs";

export function diffSnapshots(previous, next, { now = new Date(), knownKeys = null } = {}) {
  const at = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const before = indexInstances(previous);
  const after = indexInstances(next);
  const events = [];

  for (const [key, entry] of after) {
    const prior = before.get(key);
    if (!prior) {
      // Cold start: `previous` is null after a portal restart, so every running app would look new.
      // Consulting the keys already present in the history file keeps a genuine first sighting
      // recorded exactly once instead of once per restart.
      if (!previous && knownKeys?.has(key)) continue;
      events.push(event({ at, type: "firstSeen", entry, to: entry.instance.origin }));
      continue;
    }
    events.push(...compareInstances(prior, entry, at));
  }

  for (const [key, entry] of before) {
    if (after.has(key)) continue;
    events.push(event({ at, type: "inactive", entry, from: entry.instance.origin }));
  }

  return events;
}

function compareInstances(prior, entry, at) {
  const events = [];
  const a = prior.instance;
  const b = entry.instance;

  if (a.origin !== b.origin) {
    events.push(event({ at, type: "originChange", entry, from: a.origin, to: b.origin }));
  }
  if (a.health?.state !== b.health?.state) {
    events.push(event({
      at,
      type: "healthTransition",
      entry,
      from: a.health?.state ?? null,
      to: b.health?.state ?? null,
      reason: b.health?.reason ?? null,
    }));
  }
  if (a.bind?.scope !== b.bind?.scope) {
    events.push(event({ at, type: "exposureChange", entry, from: a.bind?.scope ?? null, to: b.bind?.scope ?? null }));
  }
  const priorDuplicates = duplicateCount(a);
  const nextDuplicates = duplicateCount(b);
  if (priorDuplicates !== nextDuplicates) {
    events.push(event({ at, type: "duplicateChange", entry, from: priorDuplicates, to: nextDuplicates }));
  }
  return events;
}

// Every instance a snapshot exposes, carrying the project it belongs to so events can record
// repositoryId/rootId without a second lookup.
function indexInstances(snapshot) {
  const index = new Map();
  if (!snapshot) return index;
  for (const project of snapshot.projects || []) {
    for (const instance of project.instances || []) {
      if (instance?.associationKey) index.set(instance.associationKey, { instance, project });
    }
  }
  for (const instance of snapshot.unmatchedInstances || []) {
    if (instance?.associationKey) index.set(instance.associationKey, { instance, project: null });
  }
  return index;
}

function event({ at, type, entry, from = null, to = null, reason = null }) {
  const { instance, project } = entry;
  return {
    v: HISTORY_EVENT_VERSION,
    at,
    type,
    associationKey: instance.associationKey,
    projectIdentity: project?.identity ?? instance.project?.identity ?? null,
    appId: instance.app?.id ?? null,
    // Join keys into the shared repository registry. rootId also stands in for the on-disk location
    // so no absolute path is ever written to the history file.
    repositoryId: project?.repositoryId ?? instance.project?.repositoryId ?? null,
    rootId: project?.rootId ?? instance.project?.rootId ?? null,
    from,
    to,
    reason,
  };
}

function duplicateCount(instance) {
  return Array.isArray(instance?.duplicatePorts) ? instance.duplicatePorts.length : 0;
}
