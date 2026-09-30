import test from "node:test";
import assert from "node:assert/strict";

import { weightsPie, weightsPieSvg } from "../../public/landlord/weights-pie.js";
import { setLanguage } from "../../public/i18n.js";

// The chat-first page's weights pie (always visible under "At a glance"): the saved shares of the
// Selection criteria, the ones not counted yet muted, and the landlord's bonus beside it. Angles are
// worked out by hand: a share of s % is s × 3.6 degrees, clockwise from 0, in criteria order.

const DEFAULT_WEIGHTS = { affordability: 30, schufa: 20, documents: 15, credibility: 15, employment: 15, previousLandlord: 5 };
const NO_RENT = [{ criterion: "affordability", missing: ["askingRent"] }, { requirement: "occupancyCompliant", missing: ["livingAreaSqm", "rooms"] }];

function inLanguage(lang, fn) {
  try {
    setLanguage(lang);
    return fn();
  } finally {
    setLanguage("de");
  }
}

const slice = ({ criterion, share, counted, startAngle, endAngle }) => ({ criterion, share, counted, startAngle, endAngle });

test("one slice per criterion with a share, in criteria order, angles proportional to the saved shares", () => {
  const pie = inLanguage("en", () => weightsPie({ criteria: { weights: DEFAULT_WEIGHTS }, inactive: [], bonusPoints: 5 }));
  assert.deepEqual(pie.slices.map(slice), [
    { criterion: "affordability", share: 30, counted: true, startAngle: 0, endAngle: 108 },
    { criterion: "schufa", share: 20, counted: true, startAngle: 108, endAngle: 180 },
    { criterion: "documents", share: 15, counted: true, startAngle: 180, endAngle: 234 },
    { criterion: "credibility", share: 15, counted: true, startAngle: 234, endAngle: 288 },
    { criterion: "employment", share: 15, counted: true, startAngle: 288, endAngle: 342 },
    { criterion: "previousLandlord", share: 5, counted: true, startAngle: 342, endAngle: 360 },
  ]);
  assert.deepEqual(pie.slices.map(({ label }) => label), ["Affordability", "SCHUFA", "Documents", "Credibility", "Employment", "Previous landlord"]);
});

test("a criterion at 0 % gets no slice and no legend row; the others fill the circle", () => {
  const weights = { affordability: 50, schufa: 50, documents: 0, credibility: 0, employment: 0, previousLandlord: 0 };
  const pie = inLanguage("en", () => weightsPie({ criteria: { weights }, inactive: [], bonusPoints: 5 }));
  assert.deepEqual(pie.slices.map(slice), [
    { criterion: "affordability", share: 50, counted: true, startAngle: 0, endAngle: 180 },
    { criterion: "schufa", share: 50, counted: true, startAngle: 180, endAngle: 360 },
  ]);
  assert.deepEqual(pie.legend.map(({ criterion }) => criterion), ["affordability", "schufa"]);
});

test("saved weights that do not sum to 100 are drawn as shares of their sum", () => {
  const weights = { affordability: 3, schufa: 1, documents: 0, credibility: 0, employment: 0, previousLandlord: 0 };
  const pie = weightsPie({ criteria: { weights }, inactive: [], bonusPoints: 5 });
  assert.deepEqual(pie.slices.map(({ startAngle, endAngle }) => [startAngle, endAngle]), [[0, 270], [270, 360]]);
});

test("the legend: largest share first (ties in criteria order), inactive criteria marked, EN", () => {
  const pie = inLanguage("en", () => weightsPie({ criteria: { weights: DEFAULT_WEIGHTS }, inactive: NO_RENT, bonusPoints: 5 }));
  assert.deepEqual(pie.legend, [
    { criterion: "affordability", text: "Affordability 30 % – not counted yet", counted: false },
    { criterion: "schufa", text: "SCHUFA 20 %", counted: true },
    { criterion: "documents", text: "Documents 15 %", counted: true },
    { criterion: "credibility", text: "Credibility 15 %", counted: true },
    { criterion: "employment", text: "Employment 15 %", counted: true },
    { criterion: "previousLandlord", text: "Previous landlord 5 %", counted: true },
  ]);
  assert.equal(pie.slices[0].counted, false, "the affordability slice is muted too");
  assert.equal(pie.bonusText, "👍/👎 ±5 points (your bonus)");
  assert.equal(pie.ariaLabel, "How the criteria are weighted");
});

test("German, with fractional shares and bonus points", () => {
  const weights = { affordability: 27.8, schufa: 26, documents: 13.9, credibility: 13.9, employment: 13.9, previousLandlord: 4.6 };
  const pie = inLanguage("de", () => weightsPie({ criteria: { weights }, inactive: NO_RENT, bonusPoints: 6.5 }));
  assert.equal(pie.legend[0].text, "Bezahlbarkeit 27,8 % – zählt noch nicht");
  assert.equal(pie.legend[1].text, "SCHUFA 26 %");
  assert.equal(pie.bonusText, "👍/👎 ±6,5 Punkte (Ihr Bonus)");
  assert.equal(pie.ariaLabel, "So sind die Kriterien gewichtet");
});

test("the SVG: an image labelled for screen readers, one path per slice with its criterion, muted slices marked", () => {
  const pie = inLanguage("en", () => weightsPie({ criteria: { weights: DEFAULT_WEIGHTS }, inactive: NO_RENT, bonusPoints: 5 }));
  const svg = inLanguage("en", () => weightsPieSvg(pie));
  assert.match(svg, /^<svg[\s>]/);
  assert.match(svg, /<\/svg>$/);
  assert.match(svg, /\brole="img"/);
  assert.ok(svg.includes('aria-label="How the criteria are weighted"'));
  assert.equal(svg.match(/<path\b/g).length, 6);
  for (const criterion of Object.keys(DEFAULT_WEIGHTS)) assert.ok(svg.includes(`data-criterion="${criterion}"`), criterion);
  assert.equal(svg.match(/\bis-muted\b/g).length, 1, "only affordability is muted");
  assert.match(svg, /\bwidth="120"/, "120 px by default");
  assert.match(weightsPieSvg(pie, { size: 90 }), /\bwidth="90"/);
});

test("a single criterion at 100 % is a full circle, not a zero-length arc", () => {
  const weights = { affordability: 100, schufa: 0, documents: 0, credibility: 0, employment: 0, previousLandlord: 0 };
  const svg = weightsPieSvg(weightsPie({ criteria: { weights }, inactive: [], bonusPoints: 5 }));
  assert.ok(/<circle\b[^>]*data-criterion="affordability"/.test(svg) || /<path\b[^>]*data-criterion="affordability"[^>]*d="[^"]*A[^"]*A/.test(svg), svg);
});
