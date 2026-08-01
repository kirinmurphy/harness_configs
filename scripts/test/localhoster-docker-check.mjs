#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  discoverDockerRecords,
  parseDockerPsOutput,
} from "../../modules/localhoster/docker.mjs";

// Compose-labeled container with a published port.
const composeLine = JSON.stringify({
  ID: "abc123",
  Names: "myapp-web-1",
  Image: "myapp-web",
  State: "running",
  Labels: "com.docker.compose.project=myapp,com.docker.compose.service=web,com.docker.compose.version=2.20",
  Ports: "0.0.0.0:5432->5432/tcp, :::5432->5432/tcp",
});

// Plain `docker run` container, no compose labels, no published ports.
const plainLine = JSON.stringify({
  ID: "def456",
  Names: "standalone",
  Image: "redis",
  State: "running",
  Labels: "",
  Ports: "",
});

assert.deepEqual(parseDockerPsOutput([composeLine, plainLine].join("\n")), [
  {
    containerId: "abc123",
    name: "myapp-web-1",
    image: "myapp-web",
    state: "running",
    composeProject: "myapp",
    composeService: "web",
    workingDir: null,
    publishedPorts: [{ hostPort: 5432, containerPort: 5432, protocol: "tcp" }],
  },
  {
    containerId: "def456",
    name: "standalone",
    image: "redis",
    state: "running",
    composeProject: null,
    composeService: null,
    workingDir: null,
    publishedPorts: [],
  },
]);

// The working_dir label (already present on every docker ps line for a Compose container, no
// extra `docker inspect` needed) is parsed into workingDir for auto-derivation of the project's
// filesystem identity.
const composeWithWorkingDirLine = JSON.stringify({
  ID: "ghi789",
  Names: "traefik_vps-traefik-1",
  Image: "traefik",
  State: "running",
  Labels: "com.docker.compose.project.working_dir=/Users/kirinmurphy/projects/live/traefik_vps,com.docker.compose.project=traefik_vps,com.docker.compose.service=traefik",
  Ports: "",
});
assert.equal(
  parseDockerPsOutput(composeWithWorkingDirLine)[0].workingDir,
  "/Users/kirinmurphy/projects/live/traefik_vps",
);
// A container with no working_dir label reports null, not undefined — keeps the shape stable.
assert.equal(parseDockerPsOutput(composeLine)[0].workingDir, null);

// Duplicate host:container:protocol bindings (dual-stack 0.0.0.0 + :: on the same port) collapse
// to one entry rather than appearing twice.
const dualStackPorts = parseDockerPsOutput(composeLine)[0].publishedPorts;
assert.equal(dualStackPorts.length, 1);

// A malformed line (not JSON, or missing ID) is skipped, not thrown, so one bad line never
// invalidates the rest of the scan.
assert.deepEqual(parseDockerPsOutput([
  "not json at all",
  JSON.stringify({ Names: "no-id-field" }),
  composeLine,
  "",
].join("\n")), [parseDockerPsOutput(composeLine)[0]]);

assert.deepEqual(parseDockerPsOutput(""), []);
assert.deepEqual(parseDockerPsOutput(null), []);

// Non-darwin never invokes the subprocess.
{
  const result = await discoverDockerRecords({
    platform: "linux",
    runCommand: async () => {
      throw new Error("must not execute");
    },
  });
  assert.deepEqual(result, { warnings: [], containers: [] });
}

// Docker binary not installed.
{
  const result = await discoverDockerRecords({
    platform: "darwin",
    runCommand: async () => {
      const err = new Error("spawn docker ENOENT");
      err.code = "ENOENT";
      throw err;
    },
  });
  assert.equal(result.containers.length, 0);
  assert.match(result.warnings[0], /docker CLI not found/);
}

// Docker Desktop installed but daemon not running.
{
  const result = await discoverDockerRecords({
    platform: "darwin",
    runCommand: async () => {
      throw new Error("Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?");
    },
  });
  assert.equal(result.containers.length, 0);
  assert.match(result.warnings[0], /daemon is not running/);
}

// Permission failure (e.g. user not in the docker group) is distinguished from daemon-down.
{
  const result = await discoverDockerRecords({
    platform: "darwin",
    runCommand: async () => {
      throw new Error("permission denied while trying to connect to the Docker daemon socket");
    },
  });
  assert.equal(result.containers.length, 0);
  assert.match(result.warnings[0], /permission denied/);
}

// Successful scan surfaces parsed containers with no warnings.
{
  const result = await discoverDockerRecords({
    platform: "darwin",
    runCommand: async (command, args) => {
      assert.equal(command, "docker");
      assert.deepEqual(args, ["ps", "--format", "{{json .}}"]);
      return { stdout: composeLine };
    },
  });
  assert.deepEqual(result.warnings, []);
  assert.equal(result.containers.length, 1);
  assert.equal(result.containers[0].composeProject, "myapp");
}

console.log("ok: localhoster docker provider");
