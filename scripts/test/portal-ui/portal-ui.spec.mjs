// Portal UI suite — drives the REAL roborepo portal server (booted hermetic by run.mjs, see that
// file for why the server is not a Playwright webServer fixture).
//
// Covers docs/plans/active/portal-onboarding-home.md Phase 4 acceptance:
//   - nav order Home, Agents, Plans, Tokens, Localhost
//   - the four Home entry cards link to the right routes
//   - existing deep links still load (and Home is the only default)
//   - active-nav state follows the canonical route (Home on /, Agents on /config, ...)
//   - both light and dark themes render and toggle persists
//   - keyboard focus is visible on every card and nav destination
//
// Selectors mirror the shared chrome contract: theme.js renders nav links into #nav (the active
// one gets `.active`), and Home's four cards are `.home-card` full-bleed anchors. These are the
// page's public structure, not implementation detail that can drift without a visible change.

import { test, expect } from "@playwright/test";

const NAV_ORDER = ["Home", "Agents", "Plans", "Tokens", "Localhost"];

const HOME_CARDS = [
  { title: "Agents", href: "/config" },
  { title: "Plans", href: "/plans" },
  { title: "Tokens", href: "/tokens" },
  { title: "Localhost", href: "/localhoster" },
];

// Every canonical route and the nav label that must read active on it.
const ROUTES = [
  { path: "/", active: "Home" },
  { path: "/config", active: "Agents" },
  { path: "/plans", active: "Plans" },
  { path: "/tokens", active: "Tokens" },
  { path: "/localhoster", active: "Localhost" },
];

test.describe("portal home (portal-onboarding-home)", () => {
  test("landing on / renders the static Home welcome and four cards", async ({ page }) => {
    const resp = await page.goto("/");
    expect(resp.status()).toBe(200);

    // Static first-run content — no loading overlay, no dependence on harness state.
    await expect(page.locator("h1.home-title")).toHaveText("Welcome to RoboRepo");
    await expect(page.locator(".home-lead")).toContainText("Manage your local agent configuration");
    await expect(page.locator(".home-card")).toHaveCount(4);
  });

  test("global nav order is Home, Agents, Plans, Tokens, Localhost", async ({ page }) => {
    await page.goto("/");
    const labels = await page.locator("#nav a").allTextContents();
    expect(labels.map((s) => s.trim())).toEqual(NAV_ORDER);
  });

  test("each Home card is a full-card link with the right title and href", async ({ page }) => {
    await page.goto("/");
    for (const { title, href } of HOME_CARDS) {
      const card = page.locator(".home-card", { hasText: title });
      await expect(card).toHaveCount(1);
      await expect(card).toHaveAttribute("href", href);
      // Every card carries an icon + title + one-line description.
      await expect(card.locator("portal-icon")).toHaveCount(1);
      await expect(card.locator(".home-card-desc")).not.toHaveText("");
    }
  });

  test("active nav follows the canonical route on every page", async ({ page }) => {
    for (const { path, active } of ROUTES) {
      const resp = await page.goto(path);
      expect(resp.status()).toBe(200);
      await expect(page.locator("#nav a.active")).toHaveText(active);
      await expect(page.locator("#nav a.active")).toHaveCount(1);
    }
  });

  test("deep links for /config, /plans, /tokens, /localhoster still load", async ({ page }) => {
    for (const { path } of ROUTES.slice(1)) {
      const resp = await page.goto(path);
      expect(resp.status()).toBe(200);
      // Each deep-link page renders its own <main> shell plus the shared chrome.
      await expect(page.locator("main")).toBeVisible();
    }
  });

  test("clicking a Home card navigates to its route", async ({ page }) => {
    await page.goto("/");
    await page.locator(".home-card", { hasText: "Plans" }).click();
    await expect(page).toHaveURL(/\/plans$/);
    await expect(page.locator("#nav a.active")).toHaveText("Plans");
  });

  test("default theme is dark; toggle switches to light and persists", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.locator("#theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Choice persists across navigations (localStorage, key shared with the head init script).
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // And back to dark.
    await page.locator("#theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });

  test("both themes give the Home cards a visible surface", async ({ page }) => {
    // Light and dark must both resolve a real --bg / --panel pair (no missing tokens), so the
    // cards are legible in either theme rather than transparent-over-background.
    for (const theme of ["dark", "light"]) {
      await page.goto("/");
      await page.evaluate((t) => {
        try {
          localStorage.setItem("roborepo-theme", t);
        } catch {}
        document.documentElement.dataset.theme = t;
      }, theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const bg = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      );
      const panel = await page.locator(".home-card").first().evaluate((el) =>
        getComputedStyle(el).backgroundColor,
      );
      expect(bg).not.toBe("");
      expect(panel).not.toBe("rgba(0, 0, 0, 0)");
    }
  });

  test("keyboard focus is visible on every Home card and nav destination", async ({ page }) => {
    await page.goto("/");

    // After a fresh load nothing is focused, so the first Tab lands on the first focusable
    // element — the first nav destination. Do NOT click main first: on Home the cards are
    // anchors, so a click would navigate away.
    const focusSummary = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName,
          text: (el.textContent || "").trim().slice(0, 40),
          isFocusVisible: el.matches(":focus-visible"),
          outlineStyle: cs.outlineStyle,
          outlineWidth: cs.outlineWidth,
          outlineColor: cs.outlineColor,
        };
      });

    // Tab through the five nav destinations: Home, Agents, Plans, Tokens, Localhost.
    for (const expected of NAV_ORDER) {
      await page.keyboard.press("Tab");
      const focused = await focusSummary();
      expect(focused.text, `nav should focus ${expected}, got ${focused.text}`).toBe(expected);
      expect(focused.isFocusVisible).toBe(true);
      // A real visible ring: an outline that is not `none` and not zero-width.
      expect(focused.outlineStyle).not.toBe("none");
      expect(parseFloat(focused.outlineWidth)).toBeGreaterThan(0);
    }

    // Continue tabbing into the four Home cards in DOM order.
    for (const { title } of HOME_CARDS) {
      await page.keyboard.press("Tab");
      const focused = await focusSummary();
      expect(focused.text, `focus should be card ${title}, got ${focused.text}`).toContain(title);
      expect(focused.isFocusVisible).toBe(true);
      expect(focused.outlineStyle).not.toBe("none");
      expect(parseFloat(focused.outlineWidth)).toBeGreaterThan(0);
    }
  });
});
