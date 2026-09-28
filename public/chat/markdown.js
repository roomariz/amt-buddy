// A small, safe Markdown renderer for the Orchestrator's answers.
// Everything is HTML-escaped first; only this whitelist becomes markup: paragraphs (single line
// breaks kept), headings (as h3 / h4), bullet and numbered lists, pipe tables, blockquotes,
// horizontal rules, bold, italic, inline code and links to http(s) URLs. Anything else stays text.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

// Placeholders use NUL characters, which are stripped from the input first.
const HOLD = "\u0000";

function renderInline(raw) {
  const held = [];
  const hold = (html) => `${HOLD}${held.push(html) - 1}${HOLD}`;

  let text = escapeHtml(raw);
  text = text.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`));
  // URLs never contain a placeholder (NUL), so a link or code span next to one stays outside the href.
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)\0]+)\)/g, (_, label, url) =>
    hold(anchor(url, emphasis(label))),
  );
  // Bare URLs (already escaped: stop at an escaped quote or bracket); trailing punctuation stays text.
  text = text.replace(/https?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s\0])+/g, (match) => {
    const url = match.replace(/[.,:!?)\]_*]+$/, "");
    return hold(anchor(url, url)) + match.slice(url.length);
  });
  text = emphasis(text);
  while (text.includes(HOLD)) {
    text = text.replace(new RegExp(`${HOLD}(\\d+)${HOLD}`, "g"), (_, index) => held[Number(index)]);
  }
  return text;
}

// An http(s) link. `url` is already escaped; anything that could end the attribute or open a
// tag (a quote, <, >, whitespace or a placeholder) means it is not a URL we built: show it as text.
function anchor(url, labelHtml) {
  if (!/^https?:\/\/[^\s"'<>\0]+$/.test(url)) return url;
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${labelHtml}</a>`;
}

function emphasis(text) {
  return text
    .replace(/\*\*(?=\S)([^]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\p{L}\p{N}_])__(?=\S)([^]*?\S)__(?![\p{L}\p{N}_])/gu, "$1<strong>$2</strong>")
    .replace(/(^|[^\p{L}\p{N}_*])\*(?=[^\s*])([^*]*?[^\s*])\*(?![\p{L}\p{N}_*])/gu, "$1<em>$2</em>")
    .replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([^_]*?[^\s_])_(?![\p{L}\p{N}_])/gu, "$1<em>$2</em>");
}

const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HEADING = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const isBlank = (line) => line.trim() === "";
const isTableStart = (lines, i) => lines[i].includes("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1]);
const startsBlock = (lines, i) =>
  HR.test(lines[i]) || HEADING.test(lines[i]) || BULLET.test(lines[i]) || NUMBERED.test(lines[i]) ||
  QUOTE.test(lines[i]) || isTableStart(lines, i);

function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderTable(rows) {
  const header = tableCells(rows[0]);
  const body = rows.slice(2).map((row) => {
    const cells = tableCells(row);
    return header.map((_, i) => `<td>${renderInline(cells[i] ?? "")}</td>`).join("");
  });
  return (
    '<div class="md-table"><table><thead><tr>' +
    header.map((cell) => `<th>${renderInline(cell)}</th>`).join("") +
    "</tr></thead>" +
    (body.length ? `<tbody>${body.map((row) => `<tr>${row}</tr>`).join("")}</tbody>` : "") +
    "</table></div>"
  );
}

const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, "    ").length;
const listTag = (line) => (BULLET.test(line) ? "ul" : "ol");
const itemText = (line) => (line.match(BULLET) ?? line.match(NUMBERED))[1];

// A list from line i, with items indented by two or more spaces nested one level below the
// item before them. Returns [{ tag, items: [{ text, sub }] }, index of the next line].
function parseList(lines, i) {
  const base = indentOf(lines[i]);
  const list = { tag: listTag(lines[i]), items: [] };
  while (i < lines.length && !isBlank(lines[i])) {
    const line = lines[i];
    const isItem = BULLET.test(line) || NUMBERED.test(line);
    const last = list.items.at(-1);
    if (isItem && indentOf(line) >= base + 2 && last) {
      last.sub ??= { tag: listTag(line), items: [] };
      last.sub.items.push({ text: itemText(line), sub: null });
    } else if (isItem) {
      if (listTag(line) !== list.tag && list.items.length) break;
      list.items.push({ text: itemText(line), sub: null });
    } else if (startsBlock(lines, i)) {
      break;
    } else {
      // A wrapped item continues.
      const target = last?.sub?.items.at(-1) ?? last;
      target.text += ` ${line.trim()}`;
    }
    i += 1;
  }
  return [list, i];
}

function renderList({ tag, items }) {
  const html = items.map(({ text, sub }) => `<li>${renderInline(text)}${sub ? renderList(sub) : ""}</li>`).join("");
  return `<${tag}>${html}</${tag}>`;
}

function renderBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
    } else if (HR.test(line)) {
      blocks.push("<hr>");
      i += 1;
    } else if (HEADING.test(line)) {
      const [, hashes, content] = line.match(HEADING);
      const tag = hashes.length <= 3 ? "h3" : "h4";
      blocks.push(`<${tag}>${renderInline(content)}</${tag}>`);
      i += 1;
    } else if (isTableStart(lines, i)) {
      const rows = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes("|")) rows.push(lines[i++]);
      blocks.push(renderTable(rows));
    } else if (BULLET.test(line) || NUMBERED.test(line)) {
      const [list, next] = parseList(lines, i);
      blocks.push(renderList(list));
      i = next;
    } else if (QUOTE.test(line)) {
      const quoted = [];
      while (i < lines.length && QUOTE.test(lines[i])) quoted.push(lines[i++].match(QUOTE)[1]);
      blocks.push(`<blockquote>${renderBlocks(quoted)}</blockquote>`);
    } else {
      const paragraph = [line.trim()];
      i += 1;
      while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) paragraph.push(lines[i++].trim());
      blocks.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
    }
  }
  return blocks.join("\n");
}

// Markdown text → HTML that is safe to assign to innerHTML.
export function renderMarkdown(markdown) {
  if (typeof markdown !== "string" || !markdown.trim()) return "";
  const lines = markdown.replaceAll(HOLD, "").replace(/\r\n?/g, "\n").split("\n");
  return renderBlocks(lines);
}
