import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DICTIONARIES, getLanguage, parseAttrSpec, setLanguage, t } from "../public/i18n.js";

// Every leaf key of a nested dictionary, as dotted paths ("turn.failed").
function keyPaths(node, prefix = "") {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === "object" && value !== null ? keyPaths(value, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

test("German is the default language, without a browser around", () => {
  assert.equal(getLanguage(), "de");
  assert.equal(t("turn.done"), "Antwort ist da.");
});

test("German and English have exactly the same keys", () => {
  assert.deepEqual(keyPaths(DICTIONARIES.en).sort(), keyPaths(DICTIONARIES.de).sort());
});

test("every dictionary value is a non-empty string", () => {
  for (const lang of ["de", "en"]) {
    for (const path of keyPaths(DICTIONARIES[lang])) {
      const value = path.split(".").reduce((node, part) => node[part], DICTIONARIES[lang]);
      assert.equal(typeof value, "string", `${lang}: ${path}`);
      assert.ok(value.trim(), `${lang}: ${path} is empty`);
    }
  }
});

test("t() fills in {placeholders} and follows the chosen language", () => {
  try {
    assert.equal(t("chat.confirmedValues", { summary: "Wohnfläche: 60 m²" }), "Werte bestätigt – Wohnfläche: 60 m²");
    setLanguage("en");
    assert.equal(getLanguage(), "en");
    assert.equal(t("chat.confirmedValues", { summary: "Living area: 60 m²" }), "Values confirmed – Living area: 60 m²");
  } finally {
    setLanguage("de");
  }
});

// The i18n keys a page's HTML refers to, from data-i18n and data-i18n-attr.
function htmlKeys(html) {
  const text = [...html.matchAll(/\sdata-i18n="([^"]*)"/g)].map((m) => m[1]);
  const attrs = [...html.matchAll(/\sdata-i18n-attr="([^"]*)"/g)].flatMap((m) => parseAttrSpec(m[1]).map(([, key]) => key));
  return [...text, ...attrs];
}

for (const page of ["index.html", "chatbot.html"]) {
  test(`every i18n key in ${page} exists, and the page has a DE | EN switch`, async () => {
    const html = await readFile(new URL(`../public/${page}`, import.meta.url), "utf8");
    const keys = htmlKeys(html);
    assert.ok(keys.length > 20, `${page} marks its text for translation`);
    const missing = keys.filter((key) => t(key) === key);
    assert.deepEqual(missing, [], `${page} refers to unknown keys`);
    assert.match(html, /class="lang-switch"[^>]*>[\s\S]*data-lang="de"[\s\S]*data-lang="en"/);
  });
}

test("an attribute spec names attribute and key pairs", () => {
  assert.deepEqual(parseAttrSpec("placeholder: chat.inputPlaceholder ;aria-label:chat.inputLabel;"), [
    ["placeholder", "chat.inputPlaceholder"],
    ["aria-label", "chat.inputLabel"],
  ]);
});

test("an unknown language is ignored and an unknown key shows as itself", () => {
  setLanguage("fr");
  assert.equal(getLanguage(), "de");
  assert.equal(t("no.such.key"), "no.such.key");
});
