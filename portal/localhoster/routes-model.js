// Folds the app's saved links into discovered routes. Pure, DOM-free, and shared by the browser
// dropdown plus tests.
export function mergeSavedLinks(discoveredPages, discoveredApis, userLinks = []) {
  const linksByPath = new Map(userLinks.map((link) => [link.path, link]));
  const decorate = (suggestion) => {
    const link = linksByPath.get(suggestion.path);
    if (!link) return suggestion;
    return { ...suggestion, saved: true, linkId: link.id, label: link.label || suggestion.label };
  };

  const discoveredPaths = new Set([...discoveredPages, ...discoveredApis].map((s) => s.path));
  const authored = userLinks
    .filter((link) => !discoveredPaths.has(link.path))
    .map((link) => ({ source: "user", path: link.path, label: link.label, linkId: link.id, saved: true }));

  return {
    pages: [...authored, ...discoveredPages.map(decorate)],
    // A saved link records a path, not a method. Only GET API operations can correspond to an
    // openable saved link, so non-GET operations do not inherit the saved marker.
    apis: discoveredApis.map((s) => ((s.method || "GET") === "GET" ? decorate(s) : s)),
  };
}
