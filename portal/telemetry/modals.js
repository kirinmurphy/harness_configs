// Detail-modal openers: every place the Telemetry page shows the generic key/value popup
// (portal/telemetry/panels.js's createDetailModal) with a specific data shape — a chart bar, a
// session, a spike, a loop. renders.js calls into these; app.js wires createModalOpeners() once
// at startup and hands the result to both renders.js and its own event-delegation handlers.

import { portalCopyText, portalEl as el } from "/portal/shared/api.js";
import * as api from "./api.js";
import * as tmpl from "./templates.js";
import { fmt, short, durLabel } from "./state.js";

const note = (text) => el("div", { class: "note" }, text);

// getThreshold: () => number — read fresh each call since curThreshold updates on every load().
export function createModalOpeners({ modal, getThreshold }) {
  // Generic key/value popup. rows is an array of [label, value]; null entries are dropped so callers
  // can include optional fields inline. opts.actions = [{label, onClick}] renders buttons; the extra
  // region is cleared unless a caller fills it (e.g. fetched transcript turns).
  function openModal(title, sub, rows, opts) {
    modal.open(title, sub, rows, opts);
  }

  // Fetch a flagged event's chat context (transcript turns + paste-ready prompt) and render it into
  // the modal's extra region. Best-effort: a missing transcript shows a note, never an error.
  async function fetchSessionContext(id, harness, finding, repo) {
    const extra = modal.extra();
    extra.replaceChildren(note("loading chat context…"));
    try {
      const data = await api.fetchSession({ id, harness, finding, repo });
      if (!data.found) {
        extra.replaceChildren(note("transcript not found on disk (rotated or different machine). Use the analysis prompt above."));
        return;
      }
      extra.replaceChildren(note("heaviest turns in this chat (result size = context cost):"));
      extra.append(...(data.heavy_turns || []).map(tmpl.turnRow));
    } catch (err) {
      extra.replaceChildren(note("could not load transcript: " + String((err && err.message) || err)));
    }
  }

  // Detail modal for a flagged event (spike or loop): the same key/value rows, PLUS chat-identity
  // markers (title/activity) and two actions — copy a paste-ready analysis prompt, and surface the
  // chat's heavy turns inline.
  function flaggedEventModal({ title, sub, rows, sessionId, harness, finding, repo, context }) {
    const ctxRows = context ? [
      context.title ? ["chat", context.title] : null,
      context.activity ? ["activity", context.activity] : null,
    ] : [];
    openModal(title, sub, [...ctxRows, ...rows], {
      actions: [
        { label: "surface chat context", onClick: () => fetchSessionContext(sessionId, harness, finding, repo) },
        { label: "copy analysis prompt", onClick: async () => {
          // Pull the server-built prompt (it includes the located transcript path), fall back to a
          // basic one if the transcript is gone.
          const data = await api.fetchSession({ id: sessionId, harness, finding, repo });
          await portalCopyText(data.analysis_prompt || "");
          modal.extra().replaceChildren(note("analysis prompt copied to clipboard ✓"));
        } },
      ],
    });
  }

  // Full detail for one capture (chart bar). Surfaces every field the tooltip abbreviates plus the
  // raw timestamp and cumulative total.
  function openCaptureModal(p) {
    const threshold = getThreshold();
    const spike = threshold > 0 && p.delta >= threshold;
    openModal(
      (spike ? "▲ spike · " : "") + "+" + fmt(p.delta) + " tokens",
      p.event + (p.tool ? " · " + p.tool : ""),
      [
        p.prompt ? ["prompt", p.prompt] : null,
        ["timestamp", p.ts],
        ["delta tokens", fmt(p.delta)],
        ["cumulative total", fmt(p.total)],
        ["event", p.event],
        ["tool", p.tool],
        p.mcp_tool ? ["mcp tool", p.mcp_tool] : null,
        p.file_ext ? ["file ext", "." + p.file_ext] : null,
        p.result_chars != null ? ["result size", fmt(p.result_chars) + " chars"] : null,
        p.duration_ms != null ? ["duration", p.duration_ms + " ms"] : null,
        ["spike cause", p.cause],
        ["repo", p.repo],
        ["session", p.session_id],
        ["over threshold", spike ? "yes (≥ " + fmt(threshold) + ")" : "no"],
      ]
    );
  }

  // Full session detail with chat-context actions (surface transcript turns / copy analysis prompt).
  // Shared by the sessions table and the cumulative chart's session chips.
  function openSessionModal(s) {
    flaggedEventModal({
      title: s.title || (s.repo + (s.branch ? "@" + s.branch : "") + " session"),
      sub: s.harness + " · " + short(s.session_id),
      rows: [
        ["session id", s.session_id],
        ["repo", s.repo],
        ["branch", s.branch],
        ["git sha", s.sha],
        ["harness", s.harness],
        ["started", s.first_ts],
        ["last seen", s.last_ts],
        ["duration", durLabel(s.first_ts, s.last_ts)],
        ["total tokens", fmt(s.total_tokens)],
        ["tool calls", s.tool_calls],
        ["mcp calls", s.mcp_calls],
        ["captures", s.captures],
      ],
      sessionId: s.session_id,
      harness: s.harness,
      repo: s.repo,
      finding: "total " + fmt(s.total_tokens) + " tokens over " + durLabel(s.first_ts, s.last_ts),
      context: { title: s.title, activity: s.activity, repo: s.repo, branch: s.branch, harness: s.harness },
    });
  }

  return { openModal, flaggedEventModal, openCaptureModal, openSessionModal };
}
