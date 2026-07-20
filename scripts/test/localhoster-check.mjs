#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  buildLocalhosterSnapshot,
  capabilityForPlatform,
  discoverInstances,
  isTlsTrustErrorCode,
  loadSettings,
  normalizeGitRemote,
  normalizeRoutePath,
  parseLsofFieldOutput,
  probeHttpCandidate,
  resolveProjectIdentity,
  settingsPathFor,
  updateSettings,
  validateSettings,
} from "../../modules/localhoster/index.mjs";
import { markLocalhosterRefreshFailed } from "../cli/localhoster.mjs";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roborepo-localhoster-"));
try {
  assert.equal(capabilityForPlatform("win32").discovery, "unsupported");
  assert.match(capabilityForPlatform("win32").message, /Windows/);
  assert.deepEqual(capabilityForPlatform("darwin").unavailable, []);

  const listeners = parseLsofFieldOutput([
    "p101",
    "cnode",
    "n127.0.0.1:5173",
    "n127.0.0.1:5173",
    "p202",
    "cpython",
    "n*:8000",
    "p303",
    "cpostgres",
    "n[::1]:5432",
    "p404",
    "cbad",
    "n127.0.0.1:0",
  ].join("\n"));
  assert.equal(listeners.length, 3);
  assert.equal(listeners[0].bindScope, "loopback");
  assert.equal(listeners[1].bindScope, "wildcard");
  assert.equal(listeners[2].address, "::1");

  assert.equal(normalizeGitRemote("git@github.com:KirinMurphy/Visa_Planner.git"), "git:github.com/KirinMurphy/Visa_Planner");
  assert.equal(normalizeGitRemote("https://token@github.com/kirinmurphy/visa_planner.git?x=1#frag"), "git:github.com/kirinmurphy/visa_planner");
  assert.equal(normalizeGitRemote("not a remote"), null);

  const repo = path.join(tempRoot, "repo");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git", "config"), `[remote "origin"]\n  url = git@github.com:kirinmurphy/visa_planner.git\n`);
  const appDir = path.join(repo, "apps", "web");
  fs.mkdirSync(appDir, { recursive: true });
  const identity = resolveProjectIdentity(appDir, "node");
  assert.equal(identity.identity, "git:github.com/kirinmurphy/visa_planner");
  assert.equal(identity.confidence, "high");

  const worktree = path.join(tempRoot, "worktree");
  const gitDir = path.join(tempRoot, "actual-git");
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(worktree, ".git"), `gitdir: ${gitDir}\n`);
  fs.writeFileSync(path.join(gitDir, "config"), `[remote "origin"]\n  url = https://github.com/kirinmurphy/worktree.git\n`);
  assert.equal(resolveProjectIdentity(worktree, "node").identity, "git:github.com/kirinmurphy/worktree");

  assert.equal(normalizeRoutePath("/admin?x=1#top"), "/admin?x=1#top");
  assert.equal(normalizeRoutePath("http://localhost:5173/resume?draft=1"), "/resume?draft=1");
  assert.throws(() => normalizeRoutePath("https://example.com/admin"), /loopback/);
  assert.throws(() => normalizeRoutePath("//example.com/admin"), /protocol-relative/);
  assert.throws(() => normalizeRoutePath("http://u:p@localhost/admin"), /credentials/);
  assert.equal(isTlsTrustErrorCode("DEPTH_ZERO_SELF_SIGNED_CERT"), true);
  assert.equal(isTlsTrustErrorCode("ECONNREFUSED"), false);

  const stateRoot = path.join(tempRoot, "state");
  assert.deepEqual(loadSettings({ stateRoot }), { version: 1, revision: 1, projects: {}, associations: {} });
  const updated = updateSettings({
    stateRoot,
    input: {
      revision: 1,
      type: "links",
      projectIdentity: "git:github.com/kirinmurphy/visa_planner",
      appId: "web",
      links: [{ id: "admin", label: "Admin", path: "http://localhost:5173/admin" }],
    },
  });
  assert.equal(updated.revision, 2);
  assert.equal(updated.projects["git:github.com/kirinmurphy/visa_planner"].apps.web.links[0].path, "/admin");
  const reordered = updateSettings({
    stateRoot,
    input: {
      revision: 2,
      type: "links",
      projectIdentity: "git:github.com/kirinmurphy/visa_planner",
      appId: "web",
      links: [
        { id: "resume", label: "Resume", path: "/resume" },
        { id: "admin", label: "Admin area", path: "/admin?tab=users" },
      ],
    },
  });
  assert.equal(reordered.revision, 3);
  assert.deepEqual(
    reordered.projects["git:github.com/kirinmurphy/visa_planner"].apps.web.links.map((link) => [link.id, link.label, link.path]),
    [["resume", "Resume", "/resume"], ["admin", "Admin area", "/admin?tab=users"]],
  );
  const renamed = updateSettings({
    stateRoot,
    input: {
      revision: 3,
      type: "project",
      projectIdentity: "git:github.com/kirinmurphy/visa_planner",
      name: "Visa Planner Local",
      appId: "web",
      appName: "Frontend",
      originPreference: "127.0.0.1",
    },
  });
  assert.equal(renamed.projects["git:github.com/kirinmurphy/visa_planner"].name, "Visa Planner Local");
  assert.equal(renamed.projects["git:github.com/kirinmurphy/visa_planner"].apps.web.name, "Frontend");
  assert.equal(renamed.projects["git:github.com/kirinmurphy/visa_planner"].apps.web.originPreference, "127.0.0.1");
  assert.ok(fs.existsSync(settingsPathFor(stateRoot)));
  assert.throws(() => updateSettings({ stateRoot, input: { revision: 1, type: "project", projectIdentity: "git:github.com/x/y", name: "Y" } }), /revision conflict/);
  assert.throws(() => validateSettings({ version: 1, revision: 1, projects: {}, associations: {}, future: true }), /unknown/);
  assert.throws(() => validateSettings({ version: 1, revision: 1, projects: { "git:github.com/x/y": { apps: { web: { links: [{ id: "x", label: "X", path: "/x" }, { id: "x", label: "X2", path: "/x2" }] } } } }, associations: {} }), /duplicate/);

  const calls = [];
  const runCommand = async (command, args) => {
    calls.push([command, ...args].join(" "));
    if (args.includes("-iTCP")) {
      return { stdout: ["p101", "cnode", "n127.0.0.1:5173", "p202", "cnode", "n127.0.0.1:5174", "p303", "cprocess", "n127.0.0.1:9000"].join("\n") };
    }
    if (args.includes("101")) return { stdout: `n${appDir}\n` };
    if (args.includes("202")) return { stdout: `n${appDir}\n` };
    if (args.includes("303")) return { stdout: `n${path.join(tempRoot, "loose")}\n` };
    throw new Error("unexpected command");
  };
  const discovery = await discoverInstances({
    platform: "darwin",
    runCommand,
    probeHttp: async (candidate) => (
      candidate.port === 9000
        ? { http: false }
        : { http: true, status: candidate.port === 5174 ? 401 : 200, latencyMs: 12, protocol: "http", title: `Port ${candidate.port}` }
    ),
  });
  assert.equal(discovery.instances.length, 2);
  assert.equal(calls.filter((call) => call.includes("-p 101")).length, 1);
  assert.equal(discovery.instances[1].status, 401);
  assert.notEqual(discovery.instances[0].associationKey, discovery.instances[0].key);
  assert.doesNotMatch(discovery.instances[0].associationKey, /5173|101/);

  const unsupported = await discoverInstances({
    platform: "linux",
    runCommand: async () => {
      throw new Error("must not execute");
    },
  });
  assert.equal(unsupported.capabilities.discovery, "unsupported");
  assert.equal(unsupported.instances.length, 0);

  const snapshot = buildLocalhosterSnapshot({
    discovery,
    settings: renamed,
    now: new Date("2026-07-18T18:00:00.000Z"),
  });
  assert.equal(snapshot.generatedAt, "2026-07-18T18:00:00.000Z");
  assert.equal(snapshot.projects.length, 0);
  assert.equal(snapshot.unmatchedInstances.length, 2);
  assert.equal(snapshot.inactiveProjects.length, 1);
  const failedSnapshot = markLocalhosterRefreshFailed(snapshot, {
    startedAt: "2026-07-18T18:01:00.000Z",
    error: "scan failed",
  });
  assert.equal(failedSnapshot.generatedAt, snapshot.generatedAt);
  assert.equal(failedSnapshot.refresh.state, "failed");
  assert.equal(failedSnapshot.refresh.error, "scan failed");
  assert.equal(failedSnapshot.unmatchedInstances.length, snapshot.unmatchedInstances.length);

  const associated = updateSettings({
    stateRoot,
    input: {
      revision: 4,
      type: "association",
      associationKey: discovery.instances[0].associationKey,
      projectIdentity: "git:github.com/kirinmurphy/visa_planner",
      appId: "web",
    },
  });
  const associatedSnapshot = buildLocalhosterSnapshot({
    discovery,
    settings: associated,
    now: new Date("2026-07-18T18:00:00.000Z"),
  });
  assert.equal(associatedSnapshot.generatedAt, "2026-07-18T18:00:00.000Z");
  assert.equal(associatedSnapshot.projects.length, 1);
  assert.equal(associatedSnapshot.projects[0].instances.length, 1);
  assert.equal(associatedSnapshot.unmatchedInstances.length, 1);
  assert.equal(associatedSnapshot.projects[0].instances[0].app.links[0].url, "http://127.0.0.1:5173/resume");
  assert.equal(associatedSnapshot.inactiveProjects.length, 0);

  const restartBefore = await discoverInstances({
    platform: "darwin",
    runCommand: async (command, args) => {
      if (args.includes("-iTCP")) return { stdout: ["p701", "cnode", "n127.0.0.1:5173"].join("\n") };
      if (args.includes("701")) return { stdout: `n${appDir}\n` };
      throw new Error("unexpected command");
    },
    probeHttp: async (candidate) => ({ http: true, status: 200, latencyMs: 6, protocol: "http", title: `Web ${candidate.port}` }),
  });
  const restarted = updateSettings({
    stateRoot,
    input: {
      revision: 5,
      type: "association",
      associationKey: restartBefore.instances[0].associationKey,
      projectIdentity: "git:github.com/kirinmurphy/visa_planner",
      appId: "web",
    },
  });
  const apiDir = path.join(repo, "apps", "api");
  fs.mkdirSync(apiDir, { recursive: true });
  const restartAfter = await discoverInstances({
    platform: "darwin",
    runCommand: async (command, args) => {
      if (args.includes("-iTCP")) {
        return { stdout: ["p801", "cnode", "n127.0.0.1:62345", "p802", "cnode", "n127.0.0.1:62346"].join("\n") };
      }
      if (args.includes("801")) return { stdout: `n${appDir}\n` };
      if (args.includes("802")) return { stdout: `n${apiDir}\n` };
      throw new Error("unexpected command");
    },
    probeHttp: async (candidate) => ({ http: true, status: 200, latencyMs: 7, protocol: "http", title: candidate.port === 62345 ? "Web 62345" : "API" }),
  });
  assert.equal(restartAfter.instances.find((instance) => instance.bind.port === 62345).associationKey, restartBefore.instances[0].associationKey);
  const restartSnapshot = buildLocalhosterSnapshot({
    discovery: restartAfter,
    settings: restarted,
    now: new Date("2026-07-18T18:02:00.000Z"),
  });
  assert.equal(restartSnapshot.projects.length, 1);
  assert.equal(restartSnapshot.projects[0].instances[0].origin, "http://127.0.0.1:62345");
  assert.equal(restartSnapshot.projects[0].instances[0].app.links[0].url, "http://127.0.0.1:62345/resume");
  assert.equal(restartSnapshot.unmatchedInstances.length, 1);
  assert.equal(restartSnapshot.inactiveProjects.length, 0);

  const lowConfidenceSnapshot = buildLocalhosterSnapshot({
    discovery: {
      capabilities: capabilityForPlatform("darwin"),
      warnings: [],
      instances: [{
        key: "9000",
        origin: "http://127.0.0.1:9000",
        alternateOrigins: [],
        bind: { address: "127.0.0.1", port: 9000, scope: "loopback", warning: null },
        status: 200,
        latencyMs: 5,
        protocol: "http",
        title: "Loose",
        process: { pid: 303, command: "node" },
        project: { identity: "process:/tmp:node", identityKind: "process", confidence: "low", evidence: "process working directory" },
      }],
    },
    settings: associated,
  });
  assert.equal(lowConfidenceSnapshot.unmatchedInstances.length, 1);
  assert.equal(lowConfidenceSnapshot.inactiveProjects.length, 1);

  let activeProbes = 0;
  let maxActiveProbes = 0;
  const manyListeners = Array.from({ length: 12 }, (_, index) => [
    `p${500 + index}`,
    "cnode",
    `n127.0.0.1:${7000 + index}`,
  ]).flat().join("\n");
  await discoverInstances({
    platform: "darwin",
    runCommand: async (command, args) => {
      if (args.includes("-iTCP")) return { stdout: manyListeners };
      return { stdout: `n${appDir}\n` };
    },
    probeConcurrency: 4,
    probeHttp: async () => {
      activeProbes += 1;
      maxActiveProbes = Math.max(maxActiveProbes, activeProbes);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeProbes -= 1;
      return { http: true, status: 200, latencyMs: 5, protocol: "http", title: "Concurrent" };
    },
  });
  assert.equal(maxActiveProbes, 4);

  const server = http.createServer((req, res) => {
    if (req.url === "/external") {
      res.writeHead(302, { Location: "https://example.com/out" });
      res.end();
      return;
    }
    if (req.url === "/same") {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return;
    }
    if (req.url === "/huge") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`${"x".repeat(70 * 1024)}<title>Too Late</title>`);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><title>Local App</title><link rel=\"icon\" href=\"/favicon.ico\">");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    const probe = await probeHttpCandidate({ origin: `http://127.0.0.1:${port}` });
    assert.equal(probe.http, true);
    assert.equal(probe.status, 200);
    assert.equal(probe.title, "Local App");
    assert.equal(probe.favicon, `http://127.0.0.1:${port}/favicon.ico`);
    const redirect = await probeHttpCandidate({ origin: `http://127.0.0.1:${port}/external` });
    assert.equal(redirect.redirectExternal, true);
    const sameOriginRedirect = await probeHttpCandidate({ origin: `http://127.0.0.1:${port}/same` });
    assert.equal(sameOriginRedirect.redirectExternal, false);
    assert.equal(sameOriginRedirect.redirect, `http://127.0.0.1:${port}/login`);
    const huge = await probeHttpCandidate({ origin: `http://127.0.0.1:${port}/huge` });
    assert.equal(huge.title, null);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("ok: localhoster core");
