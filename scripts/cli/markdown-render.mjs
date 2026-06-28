function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(text) {
  return escapeHtml(text).replaceAll("`", "&#96;");
}

function renderInline(text) {
  const parts = String(text).split(/(`[^`]*`)/g);
  return parts.map((part) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
    }
    let html = escapeHtml(part);
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref = escapeAttr(href);
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return html;
  }).join("");
}

function isCommentMarker(line) {
  return /^<!--\s*(BEGIN|END)\s+[^>]+-->$/.test(line.trim());
}

function renderCommentLine(line) {
  return `<p class="md-meta"><code>${escapeHtml(line.trim())}</code></p>`;
}

function renderList(items, ordered) {
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`;
}

function renderBlocks(lines) {
  const blocks = [];
  let para = [];
  let list = null;
  let quote = [];
  let code = null;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push(`<p>${renderInline(para.join(" "))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(renderList(list.items, list.ordered));
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push(`<blockquote>${quote.map((line) => `<p>${renderInline(line)}</p>`).join("")}</blockquote>`);
    quote = [];
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();

    if (code) {
      if (/^```/.test(trimmed)) {
        blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }

    if (/^```/.test(trimmed)) {
      flushPara(); flushList(); flushQuote();
      code = [];
      continue;
    }

    if (!trimmed) {
      flushPara(); flushList(); flushQuote();
      continue;
    }

    if (isCommentMarker(trimmed)) {
      flushPara(); flushList(); flushQuote();
      blocks.push(renderCommentLine(trimmed));
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara(); flushList(); flushQuote();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushPara(); flushList();
      quote.push(trimmed.replace(/^>\s?/, ""));
      continue;
    }

    const ordered = /^(\d+)\.\s+(.+)$/.exec(trimmed);
    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (ordered || unordered) {
      flushPara(); flushQuote();
      const nextOrdered = !!ordered;
      const content = (ordered || unordered)[2] || (ordered || unordered)[1];
      if (!list || list.ordered !== nextOrdered) {
        flushList();
        list = { ordered: nextOrdered, items: [] };
      }
      list.items.push(content);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara(); flushList(); flushQuote();
      blocks.push("<hr />");
      continue;
    }

    flushList(); flushQuote();
    para.push(line);
  }

  if (code) blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  flushPara(); flushList(); flushQuote();
  return blocks.join("\n");
}

export function renderMarkdown(text) {
  const normalized = String(text ?? "").replace(/\r\n/g, "\n");
  return renderBlocks(normalized.split("\n"));
}

