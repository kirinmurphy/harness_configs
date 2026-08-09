// Serves this portal's own manifest.json/sitemap.xml/robots.txt at their conventional root paths
// so the portal is a live, self-describing example of the sources modules/localhoster/metadata.mjs
// discovers on other apps — manifest.json and sitemap.xml are generated from PAGES (the same list
// portal-server.mjs already uses for nav/routing) so there is nothing to hand-sync when a page is
// added or removed.
import { send } from "./portal-routes-http.mjs";

export function handleMetadataAsset(req, res, urlPath, { pages, appName }) {
  if (urlPath === "/manifest.json") {
    send(res, 200, "application/json", JSON.stringify(buildManifest(pages, appName)));
    return true;
  }
  if (urlPath === "/sitemap.xml") {
    send(res, 200, "application/xml", buildSitemap(pages));
    return true;
  }
  if (urlPath === "/robots.txt") {
    send(res, 200, "text/plain", buildRobots());
    return true;
  }
  return false;
}

function buildManifest(pages, appName) {
  return {
    name: appName,
    short_name: appName,
    start_url: "/",
    display: "browser",
    icons: [],
  };
}

function buildSitemap(pages) {
  const urls = pages
    .map((page) => `  <url><loc>${page.path}</loc></url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// Disallow: / is deliberate and correct, not a placeholder to loosen later — this portal only ever
// binds to loopback (see LOOPBACK in portal-server.mjs) and will never actually be crawled, so the
// file's job is to be an honest, safe example of the convention rather than to invite indexing.
function buildRobots() {
  return "User-agent: *\nDisallow: /\n\nSitemap: /sitemap.xml\n";
}
