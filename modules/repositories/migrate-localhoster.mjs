import { localRepositoryId } from "./identity.mjs";
import { setAlias, upsertRepository } from "./registry.mjs";

// Import user-confirmed Localhoster aliases into the shared registry so a confirmed association like
// path:/tmp/robo -> git:host/owner/repo survives the resolver extraction. Idempotent: re-running
// never duplicates aliases or repositories, and the caller records a marker so it need not run
// twice. Pure — operates on a registry clone (call inside updateRegistry).
//
// Localhoster identities can be git:/path:/process:/roborepo:. Only git: and path: map to a
// canonical repository; process:/roborepo: aliases are skipped (there is no canonical repository to
// point them at yet) and reported so nothing is silently dropped.
export function importLocalhosterAliases(registry, localhosterSettings, { now = new Date().toISOString() } = {}) {
  const aliases = localhosterSettings?.aliases || {};
  const imported = [];
  const skipped = [];
  let changed = false;

  for (const [from, to] of Object.entries(aliases)) {
    const canonical = canonicalizeLocalhosterIdentity(to);
    if (!canonical) {
      skipped.push({ from, to, reason: "alias target is not a canonical repository" });
      continue;
    }
    // Ensure the target repository exists so the alias points at a real record.
    if (!registry.repositories[canonical.id]) {
      upsertRepository(registry, { id: canonical.id, kind: canonical.kind, displayName: canonical.displayName, now });
      changed = true;
    }
    if (setAlias(registry, from, canonical.id, { now })) {
      changed = true;
      imported.push({ from, to: canonical.id });
    }
  }

  return { changed, imported, skipped };
}

// Map a Localhoster identity string to a canonical repository descriptor, or null when it cannot be
// a canonical repository. path: identities become opaque local: ids (the realpath is never exposed
// outward — only its hash).
export function canonicalizeLocalhosterIdentity(identity) {
  if (typeof identity !== "string") return null;
  if (identity.startsWith("git:")) {
    return { id: identity, kind: "git", displayName: displayNameFromGitId(identity) };
  }
  if (identity.startsWith("path:")) {
    const realpath = identity.slice("path:".length);
    if (!realpath) return null;
    return { id: localRepositoryId(realpath), kind: "local", displayName: basename(realpath) };
  }
  return null; // process:, roborepo:, or anything else
}

function displayNameFromGitId(id) {
  const tail = id.split("/").pop() || id;
  return tail;
}

function basename(p) {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}
