import test from "node:test";
import assert from "node:assert/strict";

import { AVATAR_SHAPES, avatarSvg } from "../../public/landlord/avatar.js";
import { setLanguage } from "../../public/i18n.js";

// The chat-first page's generic avatars: the household's shape only (docs/plan/2026-09-30-
// landlord-chat-first.md, "Avatars"), never gender — the pool records it, but the AGG protects it.

function inLanguage(lang, fn) {
  try {
    setLanguage(lang);
    return fn();
  } finally {
    setLanguage("de");
  }
}

test("the four household shapes, in this order", () => {
  assert.deepEqual(AVATAR_SHAPES, ["single", "couple", "family", "group"]);
});

test("each shape is an inline SVG image labelled with the shape in the page language", () => {
  const labels = {
    en: { single: "Single adult", couple: "Couple", family: "Family with children", group: "Group of adults" },
    de: { single: "Einzelperson", couple: "Paar", family: "Familie mit Kindern", group: "Gruppe von Erwachsenen" },
  };
  for (const lang of ["en", "de"]) {
    for (const shape of AVATAR_SHAPES) {
      const svg = inLanguage(lang, () => avatarSvg(shape));
      assert.match(svg, /^<svg[\s>]/, `${lang} ${shape}`);
      assert.match(svg, /<\/svg>$/, `${lang} ${shape}`);
      assert.match(svg, /\brole="img"/, `${lang} ${shape}`);
      assert.ok(svg.includes(`aria-label="${labels[lang][shape]}"`), `${lang} ${shape}: ${svg.slice(0, 120)}`);
      assert.ok(svg.includes(`data-shape="${shape}"`), `${lang} ${shape}`);
    }
  }
});

test("the four shapes are drawn differently", () => {
  const drawings = AVATAR_SHAPES.map((shape) => avatarSvg(shape).replace(/aria-label="[^"]*"/, "").replace(/data-shape="[^"]*"/, ""));
  assert.equal(new Set(drawings).size, 4);
});

test("an unknown shape falls back to the single-adult avatar", () => {
  assert.equal(avatarSvg("unknown"), avatarSvg("single"));
  assert.equal(avatarSvg(undefined), avatarSvg("single"));
});

test("the size option sets width and height (default 48)", () => {
  assert.match(avatarSvg("couple"), /\bwidth="48"/);
  assert.match(avatarSvg("couple"), /\bheight="48"/);
  assert.match(avatarSvg("couple", { size: 24 }), /\bwidth="24"/);
  assert.match(avatarSvg("couple", { size: 24 }), /\bheight="24"/);
});

test("no gendered wording in any avatar", () => {
  for (const lang of ["en", "de"]) {
    for (const shape of AVATAR_SHAPES) {
      const svg = inLanguage(lang, () => avatarSvg(shape)).toLowerCase();
      for (const word of ["male", "female", "man", "woman", "mann", "frau", "gender", "geschlecht"]) {
        assert.ok(!new RegExp(`\\b${word}\\b`).test(svg), `${lang} ${shape} contains '${word}'`);
      }
    }
  }
});
