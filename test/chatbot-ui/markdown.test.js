import test from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown } from "../../public/chat/markdown.js";

test("paragraphs are split on blank lines; single line breaks stay line breaks", () => {
  assert.equal(renderMarkdown("Erste Zeile\nzweite Zeile\n\nNeuer Absatz"), "<p>Erste Zeile<br>zweite Zeile</p>\n<p>Neuer Absatz</p>");
});

test("bold, italic and inline code", () => {
  assert.equal(
    renderMarkdown("**Feld C4** und *Schätzung* und __fett__ und `code **nicht fett**`"),
    "<p><strong>Feld C4</strong> und <em>Schätzung</em> und <strong>fett</strong> und <code>code **nicht fett**</code></p>",
  );
});

test("underscores inside words and lone asterisks stay text", () => {
  assert.equal(renderMarkdown("snake_case_name und 3 * 4 = 12"), "<p>snake_case_name und 3 * 4 = 12</p>");
});

test("headings become small headings inside the answer bubble", () => {
  assert.equal(renderMarkdown("### Mietspiegel 2026\n#### Referenzspanne"), "<h3>Mietspiegel 2026</h3>\n<h4>Referenzspanne</h4>");
});

test("bullet and numbered lists", () => {
  assert.equal(
    renderMarkdown("- **Wohnlage**: gut\n* Baujahr: 1905\n\n1. Adresse prüfen\n2) Mietspiegel"),
    "<ul><li><strong>Wohnlage</strong>: gut</li><li>Baujahr: 1905</li></ul>\n<ol><li>Adresse prüfen</li><li>Mietspiegel</li></ol>",
  );
});

test("a list directly after a paragraph line starts its own block", () => {
  assert.equal(renderMarkdown("Ergebnis:\n- 474 €\n- 690 €"), "<p>Ergebnis:</p>\n<ul><li>474 €</li><li>690 €</li></ul>");
});

test("pipe tables with a header row", () => {
  assert.equal(
    renderMarkdown("| Wert | Betrag |\n|---|---:|\n| Untergrenze | **474 €** |\n| Obergrenze | 690 € |"),
    '<div class="md-table"><table><thead><tr><th>Wert</th><th>Betrag</th></tr></thead>' +
      "<tbody><tr><td>Untergrenze</td><td><strong>474 €</strong></td></tr><tr><td>Obergrenze</td><td>690 €</td></tr></tbody></table></div>",
  );
});

test("links only for http(s) URLs, opening in a new tab", () => {
  assert.equal(
    renderMarkdown("[Mietspiegel](https://www.berlin.de/mietspiegel/?a=1&b=2)"),
    '<p><a href="https://www.berlin.de/mietspiegel/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">Mietspiegel</a></p>',
  );
  assert.equal(renderMarkdown("[klick](javascript:alert(1))"), "<p>[klick](javascript:alert(1))</p>");
  assert.equal(renderMarkdown("[klick](data:text/html,x)"), "<p>[klick](data:text/html,x)</p>");
});

test("raw HTML in the text is shown as text, never as markup", () => {
  assert.equal(
    renderMarkdown('<img src=x onerror="alert(1)"> **<b>fett</b>**'),
    "<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; <strong>&lt;b&gt;fett&lt;/b&gt;</strong></p>",
  );
});

test("a link text or URL cannot break out of the attribute", () => {
  const html = renderMarkdown('[x](https://example.org/"onmouseover="alert(1))');
  assert.doesNotMatch(html, /" onmouseover|"onmouseover/);
});

test("blockquotes and horizontal rules", () => {
  assert.equal(
    renderMarkdown("> *Hinweis:* keine Rechtsberatung\n\n---"),
    "<blockquote><p><em>Hinweis:</em> keine Rechtsberatung</p></blockquote>\n<hr>",
  );
});

test("empty or non-string input renders nothing", () => {
  assert.equal(renderMarkdown(""), "");
  assert.equal(renderMarkdown(undefined), "");
});

test("the Orchestrator's italic disclaimer paragraph", () => {
  assert.equal(
    renderMarkdown("Antwort.\n\n_Dies ist keine Rechtsberatung. Wenden Sie sich an eine Anwältin bzw. einen Anwalt._"),
    "<p>Antwort.</p>\n<p><em>Dies ist keine Rechtsberatung. Wenden Sie sich an eine Anwältin bzw. einen Anwalt.</em></p>",
  );
});

test("bare http(s) URLs become links, trailing punctuation stays text", () => {
  assert.equal(
    renderMarkdown("Quelle: https://daten.berlin.de/datensaetze/wohnlagen-2026). Mehr: http://x.de/a?b=1&c=2."),
    '<p>Quelle: <a href="https://daten.berlin.de/datensaetze/wohnlagen-2026" target="_blank" rel="noopener noreferrer">https://daten.berlin.de/datensaetze/wohnlagen-2026</a>). ' +
      'Mehr: <a href="http://x.de/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">http://x.de/a?b=1&amp;c=2</a>.</p>',
  );
});

test("an indented list inside a list item is nested one level", () => {
  assert.equal(
    renderMarkdown("- Mietspiegel-Bereich:\n  - Untergrenze: 474 €\n  - Obergrenze: 690 €\n- Ihre Miete: 900 €"),
    "<ul><li>Mietspiegel-Bereich:<ul><li>Untergrenze: 474 €</li><li>Obergrenze: 690 €</li></ul></li><li>Ihre Miete: 900 €</li></ul>",
  );
});

test("a bare URL at the end of an italic sentence keeps the italics", () => {
  assert.equal(
    renderMarkdown("_Quelle: https://daten.berlin.de/x_"),
    '<p><em>Quelle: <a href="https://daten.berlin.de/x" target="_blank" rel="noopener noreferrer">https://daten.berlin.de/x</a></em></p>',
  );
  assert.equal(
    renderMarkdown("**Quelle: https://daten.berlin.de/x**"),
    '<p><strong>Quelle: <a href="https://daten.berlin.de/x" target="_blank" rel="noopener noreferrer">https://daten.berlin.de/x</a></strong></p>',
  );
});

test("a URL never swallows a link or code span next to it (no markup inside an href)", () => {
  const inputs = [
    "https://a.com[l](http://x/onmouseover=onerror=alert;throw/XSS/.source//)",
    'https://a.com`x"y`',
    '[l](https://a`x"y`)',
  ];
  for (const input of inputs) {
    const html = renderMarkdown(input);
    for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
      assert.doesNotMatch(href, /[<>]/, `${input} → ${html}`);
    }
    assert.equal((html.match(/<a /g) ?? []).length, (html.match(/<\/a>/g) ?? []).length);
    assert.doesNotMatch(html, /<a [^>]*<a /, `${input} → ${html}`);
  }
  assert.equal(
    renderMarkdown("https://a.com[l](http://x/y)"),
    '<p><a href="https://a.com" target="_blank" rel="noopener noreferrer">https://a.com</a>' +
      '<a href="http://x/y" target="_blank" rel="noopener noreferrer">l</a></p>',
  );
});
