#!/usr/bin/env node
// Repository-keyed card merging: instances that share a repositoryId belong on one card regardless
// of which discovery mechanism found them. Before this, a repo running a Compose stack, a dev
// server, and a tunnel produced three unrelated cards in three separate page sections.
import assert from "node:assert/strict";
import { buildLocalhosterSnapshot, defaultSettings } from "../../modules/localhoster/index.mjs";

const MENUGOATS = "git:github.com/ryanem/menugoats";
const LOCAL = "local:616846d49a69fc81";
const LOCAL_PATH = "path:/tmp/thing";

// Discovery-shaped instance, as buildLocalhosterSnapshot expects it (pre-snapshot, so no opaqueKey).
function instance({ pid, port, command, identity, repositoryId, docker = null, status = null, title = null, cpu = null }) {
  return {
    key: `${pid}:127.0.0.1:${port}`,
    associationKey: `a${pid}${port}`,
    matchSignature: { key: `a${pid}${port}`, titleKey: `t${pid}${port}`, relativeCwd: ".", command, title },
    origin: `http://127.0.0.1:${port}`,
    alternateOrigins: [],
    bind: { address: "127.0.0.1", port, scope: "loopback", warning: null },
    status,
    latencyMs: null,
    protocol: "http",
    tls: null,
    title,
    health: null,
    docker,
    processMetrics: { cpuPercent: cpu, cpuPercentOfHost: cpu, residentMemoryKb: 1000 },
    process: { pid, command },
    project: {
      identity,
      identityKind: identity.startsWith("git:") ? "git" : identity.startsWith("path:") ? "path" : "process",
      confidence: "high",
      projectRoot: "/tmp/menugoats",
      evidence: "Git remote",
      repositoryId,
      git: null,
    },
  };
}

// Mirrors the live shape on the development machine: Supabase publishes 11 containers under one
// Compose project, none of which set com.docker.compose.service.
const composeContainers = Array.from({ length: 11 }, (_, index) =>
  instance({
    pid: 200 + index,
    port: 54321 + index,
    command: "com.docker.backend",
    identity: `process:/tmp/x:${index}`,
    repositoryId: null,
    docker: {
      containerId: `c${index}`,
      name: `supabase_svc${index}_menugoats`,
      composeService: null,
      composeProject: "menugoats",
      image: "supabase",
      state: "running",
    },
    cpu: 0.3,
  }));

const discovery = {
  capabilities: { discovery: "supported" },
  warnings: [],
  composeProjectGit: new Map([
    ["menugoats", { git: null, repositoryId: MENUGOATS, resolvedFrom: "auto-bind" }],
  ]),
  instances: [
    ...composeContainers,
    instance({ pid: 300, port: 3000, command: "node", identity: MENUGOATS, repositoryId: MENUGOATS, status: 200, title: "Menugoats", cpu: 0.4 }),
    // A tunnel launched from the repo. It answers its own HTTP probe (ngrok serves an inspector UI),
    // so it is indistinguishable from the dev server on every field the instance record carries and
    // merges as an ordinary member.
    instance({ pid: 301, port: 4040, command: "ngrok", identity: MENUGOATS, repositoryId: MENUGOATS, status: 302, cpu: 9.9 }),
    instance({ pid: 400, port: 4321, command: "localhostr", identity: "path:/tmp/thing", repositoryId: LOCAL, status: 200, title: "Localhostr", cpu: 0.5 }),
    instance({ pid: 401, port: 63359, command: "node", identity: "path:/tmp/thing", repositoryId: LOCAL, status: 200, title: "Node", cpu: 0.2 }),
    instance({ pid: 402, port: 63409, command: "deno", identity: "path:/tmp/thing", repositoryId: LOCAL, status: 200, title: "Deno", cpu: 0.1 }),
    // process: identity -> canonicalRepositoryId returns null -> no repository to be a member of.
    instance({ pid: 500, port: 9999, command: "stray", identity: "process:/tmp:stray", repositoryId: null, status: 200, title: "Stray" }),
  ],
};

const snapshot = buildLocalhosterSnapshot({
  discovery,
  settings: defaultSettings(),
  now: new Date("2026-08-02T00:00:00.000Z"),
});

const menugoats = snapshot.repositories.find((entry) => entry.repositoryId === MENUGOATS);
const local = snapshot.repositories.find((entry) => entry.repositoryId === LOCAL);

// Three former cards (compose + node + ngrok) collapse to one.
assert.equal(snapshot.repositories.length, 2);
assert.ok(menugoats);
assert.equal(menugoats.identityKind, "git");
assert.equal(menugoats.providerUrl, "https://github.com/ryanem/menugoats");

// The Compose stack stays a sub-group rather than flattening 11 containers into the member list
// ahead of the one dev server that matters.
assert.equal(menugoats.composeGroups.length, 1);
assert.equal(menugoats.composeGroups[0].containers.length, 11);
assert.equal(menugoats.composeGroups[0].resolvedFrom, "auto-bind");
assert.equal(menugoats.members.length, 2);
assert.ok(menugoats.members.some((member) => member.port === 3000));
assert.ok(menugoats.members.some((member) => member.port === 4040));

// Aggregate is compose (11 x 0.3) + node (0.4) + ngrok (9.9). Every member counts for now — see the
// aggregate comment in snapshot.mjs for why tool processes are not yet excluded.
assert.ok(Math.abs(menugoats.cpuPercentOfHost - 13.6) < 1e-9);

// An un-pushed repository still merges; it is persistent, just not portable across machines.
assert.ok(local);
assert.equal(local.identityKind, "local");
assert.equal(local.providerUrl, null);
assert.equal(local.members.length, 3);

// git-backed repositories sort ahead of path-derived ones.
assert.equal(snapshot.repositories[0].repositoryId, MENUGOATS);

// A process: identity has no repository and never becomes a member.
assert.ok(!snapshot.repositories.some((entry) => entry.members.some((member) => member.port === 9999)));

// The legacy collections stay populated through the migration so existing consumers keep working.
assert.equal(snapshot.composeProjects.length, 1);
assert.ok(Array.isArray(snapshot.projects));
assert.ok(Array.isArray(snapshot.unmatchedInstances));

// Members carry their full instance record and Compose groups carry their whole project record, so
// the portal renders each with the card it already used rather than a reduced shape.
assert.ok(menugoats.members.every((member) => member.instance?.bind?.port === member.port));
assert.equal(menugoats.composeGroups[0].name, "menugoats");
assert.ok(Array.isArray(menugoats.composeGroups[0].containers));

// An instance with a repositoryId appears in BOTH unmatchedInstances (legacy, kept during the
// migration) and as a repository member. The portal de-duplicates by rendering only unmatched
// instances without a repositoryId, so that filter must leave nothing double-rendered and nothing
// dropped: the two partitions have to exactly reconstruct the legacy collection.
const memberPorts = new Set(snapshot.repositories.flatMap((entry) => entry.members.map((member) => member.port)));
const portalRenders = snapshot.unmatchedInstances.filter((item) => !item.project?.repositoryId);
assert.ok(portalRenders.every((item) => !memberPorts.has(item.bind.port)));
assert.ok(snapshot.unmatchedInstances
  .filter((item) => item.project?.repositoryId)
  .every((item) => memberPorts.has(item.bind.port)));

// One process on several ports is ONE member. A dev server binding a main port plus an HMR socket
// previously rendered as two sibling members, overstating what was running.
const multiPort = buildLocalhosterSnapshot({
  discovery: {
    capabilities: { discovery: "supported" },
    warnings: [],
    composeProjectGit: new Map(),
    instances: [
      instance({ pid: 700, port: 4321, command: "node", identity: LOCAL_PATH, repositoryId: LOCAL, status: 200, title: "Localhostr", cpu: 0.5 }),
      instance({ pid: 700, port: 63359, command: "node", identity: LOCAL_PATH, repositoryId: LOCAL, status: 200, cpu: 0.5 }),
      instance({ pid: 701, port: 63409, command: "deno", identity: LOCAL_PATH, repositoryId: LOCAL, status: 200, cpu: 0.1 }),
    ],
  },
  settings: defaultSettings(),
  now: new Date("2026-08-02T00:00:00.000Z"),
});
const collapsed = multiPort.repositories[0];
assert.equal(collapsed.members.length, 2);

// The titled port survives as the visible member; its untitled sibling becomes metadata.
const survivor = collapsed.members.find((member) => member.port === 4321);
assert.ok(survivor);
assert.deepEqual(survivor.secondaryPorts, [63359]);
assert.equal(survivor.entrypoint, true);

// A port that answered with a page title is user-facing and must sort above infrastructure, so
// opening the app stays one click from page load.
assert.equal(collapsed.members[0].port, 4321);
assert.equal(collapsed.members.find((member) => member.port === 63409).entrypoint, false);

// Same-PID multi-port listeners are normal, not stale: no duplicate warning for them.
assert.equal(collapsed.duplicateGroups.length, 0);

// Several processes serving the same shape are the stale-instance case. The upstream shape pass
// collapses them to one visible card and records their ports; the repository surfaces that as a
// warning. Same signature (identical title + relative cwd + command) is what makes them duplicates.
const staleInstances = [
  instance({ pid: 800, port: 5173, command: "node", identity: LOCAL_PATH, repositoryId: LOCAL, status: 200, title: "App", cpu: 0.2 }),
  instance({ pid: 801, port: 5174, command: "node", identity: LOCAL_PATH, repositoryId: LOCAL, status: 200, title: "App", cpu: 0.2 }),
];
for (const item of staleInstances) {
  item.matchSignature = { ...item.matchSignature, key: "shared-shape", titleKey: "shared-shape-title" };
  item.associationKey = "shared-shape";
}
const stale = buildLocalhosterSnapshot({
  discovery: {
    capabilities: { discovery: "supported" },
    warnings: [],
    composeProjectGit: new Map(),
    instances: staleInstances,
  },
  settings: defaultSettings(),
  now: new Date("2026-08-02T00:00:00.000Z"),
});
assert.equal(stale.repositories[0].duplicateGroups.length, 1);
assert.deepEqual(stale.repositories[0].duplicateGroups[0].ports, [5173, 5174]);

// A repository with no measurable CPU reports null rather than a confident 0%.
const unmeasured = buildLocalhosterSnapshot({
  discovery: {
    capabilities: { discovery: "supported" },
    warnings: [],
    composeProjectGit: new Map(),
    instances: [
      { ...instance({ pid: 600, port: 7000, command: "node", identity: MENUGOATS, repositoryId: MENUGOATS, status: 200, title: "Quiet" }), processMetrics: null },
    ],
  },
  settings: defaultSettings(),
  now: new Date("2026-08-02T00:00:00.000Z"),
});
assert.equal(unmeasured.repositories[0].cpuPercentOfHost, null);

console.log("localhoster repository merge check passed");
