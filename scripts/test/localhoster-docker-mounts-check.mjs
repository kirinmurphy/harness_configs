#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  collectDockerMounts,
  parseDockerInspectOutput,
} from "../../modules/localhoster/docker-mounts.mjs";

// Real `docker inspect --format {{json .}}` shape, trimmed to the fields this parser reads.
const inspectLine = JSON.stringify({
  Id: "41bd7109cb82fabd0d80c1c06834ea9894bcb567b073cccab7492642d2af3903",
  Name: "/supabase_studio_menugoats",
  Mounts: [
    { Type: "bind", Source: "/Users/me/projects/menugoats/supabase/snippets", Destination: "/snippets" },
    { Type: "volume", Source: "/var/lib/docker/volumes/data/_data", Destination: "/data" },
  ],
});

// Keyed by the SHORT id: docker inspect reports the full 64-char Id, every container record in this
// module carries the 12-char form from `docker ps`, and the join happens on the short one.
assert.deepEqual(parseDockerInspectOutput(inspectLine), new Map([
  ["41bd7109cb82", ["/Users/me/projects/menugoats/supabase/snippets"]],
]));

// Named volumes are excluded — they live inside Docker's storage and say nothing about where the
// project lives on the host.
assert.deepEqual(
  parseDockerInspectOutput(JSON.stringify({
    Id: "aaaaaaaaaaaabbbb",
    Mounts: [{ Type: "volume", Source: "/var/lib/docker/volumes/x/_data" }],
  })).get("aaaaaaaaaaaa"),
  [],
);

// A container with no mounts at all reports an empty list, not undefined — keeps the shape stable
// for callers iterating every container in a project.
assert.deepEqual(
  parseDockerInspectOutput(JSON.stringify({ Id: "ccccccccccccdddd", Mounts: [] })).get("cccccccccccc"),
  [],
);
assert.deepEqual(
  parseDockerInspectOutput(JSON.stringify({ Id: "eeeeeeeeeeeeffff" })).get("eeeeeeeeeeee"),
  [],
);

// Duplicate sources collapse to one entry.
assert.deepEqual(
  parseDockerInspectOutput(JSON.stringify({
    Id: "111111111111aaaa",
    Mounts: [
      { Type: "bind", Source: "/repo/app" },
      { Type: "bind", Source: "/repo/app" },
    ],
  })).get("111111111111"),
  ["/repo/app"],
);

// A relative or empty Source is rejected rather than handed to path resolution.
assert.deepEqual(
  parseDockerInspectOutput(JSON.stringify({
    Id: "222222222222aaaa",
    Mounts: [{ Type: "bind", Source: "relative/path" }, { Type: "bind", Source: "" }],
  })).get("222222222222"),
  [],
);

// Malformed lines and entries missing an Id are skipped, not thrown, so one bad line never
// invalidates the batch.
assert.deepEqual(parseDockerInspectOutput([
  "not json",
  JSON.stringify({ Mounts: [{ Type: "bind", Source: "/no/id" }] }),
  inspectLine,
  "",
].join("\n")), parseDockerInspectOutput(inspectLine));

assert.deepEqual(parseDockerInspectOutput(""), new Map());
assert.deepEqual(parseDockerInspectOutput(null), new Map());

// Non-darwin never invokes the subprocess.
{
  const result = await collectDockerMounts(["abc123"], {
    platform: "linux",
    runCommand: async () => {
      throw new Error("must not execute");
    },
  });
  assert.deepEqual(result, new Map());
}

// An empty id list never invokes the subprocess — the common case (every project resolved by
// working_dir) must cost nothing.
{
  const result = await collectDockerMounts([], {
    platform: "darwin",
    runCommand: async () => {
      throw new Error("must not execute");
    },
  });
  assert.deepEqual(result, new Map());
}

// Ids are deduped into a single batched invocation rather than one call per container.
{
  let capturedArgs;
  await collectDockerMounts(["abc123", "abc123", "def456"], {
    platform: "darwin",
    runCommand: async (command, args) => {
      assert.equal(command, "docker");
      capturedArgs = args;
      return { stdout: "" };
    },
  });
  assert.deepEqual(capturedArgs, ["inspect", "--format", "{{json .}}", "abc123", "def456"]);
}

// A container that exited between `docker ps` and here makes `docker inspect` exit non-zero; that
// costs a repo association, never the scan.
{
  const result = await collectDockerMounts(["gone"], {
    platform: "darwin",
    runCommand: async () => {
      throw new Error("Error: No such object: gone");
    },
  });
  assert.deepEqual(result, new Map());
}

// Docker Desktop on macOS reports bind sources through its VM gateway prefix. Every consumer
// compares these against real host paths, so the prefix comes off here — a stack whose mounts
// "resolve to no checkout" is indistinguishable from a legitimately shared one.
assert.deepEqual(
  parseDockerInspectOutput(JSON.stringify({
    Id: "ccccccccccccdddd",
    Mounts: [{ Type: "bind", Source: "/host_mnt/Users/me/app/data" }],
  })).get("cccccccccccc"),
  ["/Users/me/app/data"],
);

// Repeated slashes come off for the same reason: a compose file interpolating a variable that
// already ends in "/" — TMPDIR on macOS does — produces these, and no prefix comparison matches
// them. Caught on the live fixture, whose scratch repo lives under TMPDIR.
assert.deepEqual(
  parseDockerInspectOutput(JSON.stringify({
    Id: "eeeeeeeeeeeeffff",
    Mounts: [{ Type: "bind", Source: "/var/folders/ab/T//fixture/data" }],
  })).get("eeeeeeeeeeee"),
  ["/var/folders/ab/T/fixture/data"],
);

// Both at once, and the de-dup still applies: two sources that differ only in slash count are one
// path, not two.
assert.deepEqual(
  parseDockerInspectOutput(JSON.stringify({
    Id: "1111111111112222",
    Mounts: [
      { Type: "bind", Source: "/host_mnt/var/folders/ab/T//fixture/data" },
      { Type: "bind", Source: "/host_mnt/var/folders/ab/T/fixture/data" },
    ],
  })).get("111111111111"),
  ["/var/folders/ab/T/fixture/data"],
);

console.log("ok: localhoster docker-mounts provider");
