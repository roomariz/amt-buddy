import test from "node:test";
import assert from "node:assert/strict";

import { breakdownBars, documentFlags, exclusionText, rankingRows } from "../../public/landlord/ranking.js";
import { setLanguage } from "../../public/i18n.js";

const complete = { schufa: "present", incomeProof: "present", previousLandlord: "present", arrears: false, complete: true };
const incomplete = { schufa: "expired", incomeProof: "present", previousLandlord: "not_required", arrears: false, complete: false };

// Ranked entries as GET /api/v1/landlord/:landlordId/dashboard returns them.
const RANKED = [
  { applicantId: "A-003", rank: 1, matchScore: 91.5, rentToIncome: 0.3, name: "Zoe Weber", documents: complete },
  { applicantId: "A-001", rank: 2, matchScore: 80, rentToIncome: 0.22, name: "Ali Kaya", documents: incomplete },
  { applicantId: "A-002", rank: 3, matchScore: 62.1, rentToIncome: 0.38, name: "Jonas Becker", documents: complete },
];

const ids = (rows) => rows.map(({ applicantId }) => applicantId);

test("the table is sorted by Match score by default and can be sorted by name or rent-to-income", () => {
  assert.deepEqual(ids(rankingRows(RANKED)), ["A-003", "A-001", "A-002"]);
  assert.deepEqual(ids(rankingRows(RANKED, { sort: "name" })), ["A-001", "A-002", "A-003"]);
  assert.deepEqual(ids(rankingRows(RANKED, { sort: "rentToIncome" })), ["A-001", "A-003", "A-002"]);
  assert.deepEqual(ids(rankingRows(RANKED, { sort: "unknown" })), ["A-003", "A-001", "A-002"]);
});

test("the table can be filtered to complete documents only", () => {
  assert.deepEqual(ids(rankingRows(RANKED, { completeOnly: true })), ["A-003", "A-002"]);
  assert.deepEqual(ids(rankingRows(RANKED, { completeOnly: true, sort: "name" })), ["A-002", "A-003"]);
});

test("sorting and filtering leave the dashboard's list as it was", () => {
  const copy = structuredClone(RANKED);
  rankingRows(RANKED, { sort: "name", completeOnly: true });
  assert.deepEqual(RANKED, copy);
});

test("the breakdown bars: each criterion's subscore as a percentage, with its weight", () => {
  const breakdown = {
    affordability: { subscore: 0.4444, weight: 30 },
    schufa: { subscore: 0.5, weight: 20 },
    documents: { subscore: 1, weight: 15 },
    credibility: { subscore: 0.7, weight: 15 },
    employment: { subscore: 0.6, weight: 15 },
    previousLandlord: { subscore: 0.5, weight: 5 },
  };
  assert.deepEqual(breakdownBars({ breakdown }), [
    { criterion: "affordability", percent: 44, weight: 30 },
    { criterion: "schufa", percent: 50, weight: 20 },
    { criterion: "documents", percent: 100, weight: 15 },
    { criterion: "credibility", percent: 70, weight: 15 },
    { criterion: "employment", percent: 60, weight: 15 },
    { criterion: "previousLandlord", percent: 50, weight: 5 },
  ]);
});

test("the document flags say which documents are fine", () => {
  assert.deepEqual(documentFlags(incomplete), [
    { document: "schufa", status: "expired", ok: false },
    { document: "incomeProof", status: "present", ok: true },
    { document: "previousLandlord", status: "not_required", ok: true },
  ]);
});

test("a previous-landlord confirmation that reports rent arrears is flagged as a problem", () => {
  const [, , previousLandlord] = documentFlags({ ...complete, arrears: true });
  assert.deepEqual(previousLandlord, { document: "previousLandlord", status: "arrears", ok: false });
});

test("an exclusion reason reads in the page language, with its values filled in", () => {
  const reasons = [
    { requirement: "occupancyCompliant", householdSize: 7, requiredAreaSqm: 63, livingAreaSqm: 50 },
    { requirement: "maxRentToIncome", rentToIncome: 0.3571, limit: 0.33 },
    { requirement: "latestMoveIn", moveInDate: "2026-11-01", limit: "2026-10-15" },
    { requirement: "schufaCleanOnly", schufaStatus: "negative" },
    { requirement: "completeDocumentsOnly", documents: ["schufa", "incomeProof"] },
    { requirement: "noPets" },
    { requirement: "noSmoking" },
  ];
  try {
    for (const lang of ["de", "en"]) {
      setLanguage(lang);
      for (const reason of reasons) {
        const text = exclusionText(reason);
        assert.ok(text && !text.includes("{") && !text.startsWith("landlord."), `${lang}: ${text}`);
      }
    }
    setLanguage("en");
    assert.equal(exclusionText(reasons[0]), "A household of 7 needs at least 63 m² (§ 7 WoAufG Bln); the flat has 50 m².");
    assert.equal(exclusionText(reasons[1]), "The rent is 35.7 % of the net household income (at most 33 %).");
    setLanguage("de");
    assert.equal(exclusionText(reasons[1]), "Die Miete ist 35,7 % des Haushaltsnettoeinkommens (höchstens 33 %).");
  } finally {
    setLanguage("de");
  }
});
