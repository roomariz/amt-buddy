// adjustSelectionCriteria: relative weight changes computed in code, with limits. Every expected
// share below is worked by hand from the rules in docs/plan/2026-09-30-landlord-chat-first.md.
import test from "node:test";
import assert from "node:assert/strict";

import { adjustSelectionCriteria, CriteriaInputError } from "../../src/landlord/criteria.js";
import { createLandlordStore } from "../../src/landlord/store.js";

function setup(weights) {
  const store = createLandlordStore({ path: ":memory:" });
  const { landlordId } = store.signIn("Erika Muster");
  if (weights) store.saveCriteria(landlordId, { ...store.getCriteria(landlordId), weights });
  const adjust = (changes) => adjustSelectionCriteria({ store, landlordId, changes });
  return { store, landlordId, adjust };
}

// Shares compared to 1e-9, so that 20 × 1.3 = 26.000000000000004 counts as 26.
function assertShares(actual, expected) {
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const [criterion, share] of Object.entries(expected)) {
    assert.ok(Math.abs(actual[criterion] - share) < 1e-9, `${criterion}: ${actual[criterion]}, expected ${share}`);
  }
}

const zeroes = { affordability: 0, schufa: 0, documents: 0, credibility: 0, employment: 0, previousLandlord: 0 };

test("a factor changes the named share; the others keep their proportions and fill the rest (the plan's example)", () => {
  const { store, landlordId, adjust } = setup();

  const { previous, criteria, applied } = adjust([{ criterion: "schufa", by: "factor", value: 1.3 }]);

  // SCHUFA 20 → 26; the other five (80 together) scaled to 74.
  assertShares(criteria.weights, { affordability: 27.75, schufa: 26, documents: 13.875, credibility: 13.875, employment: 13.875, previousLandlord: 4.625 });
  assert.equal(applied.length, 1);
  const [{ criterion, from, requested, to, capped }] = applied;
  assert.deepEqual([criterion, from, capped], ["schufa", 20, false]);
  assert.ok(Math.abs(requested - 26) < 1e-9 && Math.abs(to - 26) < 1e-9);
  assert.equal(previous.weights.schufa, 20);
  assert.deepEqual(criteria.requirements, previous.requirements);
  assertShares(store.getCriteria(landlordId).weights, criteria.weights);
});

test("a target share sets the named share directly", () => {
  const { adjust } = setup();

  const { criteria, applied } = adjust([{ criterion: "schufa", by: "share", value: 40 }]);

  // The other five (80) scaled to 60.
  assertShares(criteria.weights, { affordability: 22.5, schufa: 40, documents: 11.25, credibility: 11.25, employment: 11.25, previousLandlord: 3.75 });
  assert.deepEqual(applied, [{ criterion: "schufa", from: 20, requested: 40, to: 40, capped: false }]);
});

test("several changes in one call: 'stable income matters most'", () => {
  const { criteria } = setup().adjust([
    { criterion: "employment", by: "factor", value: 2 },
    { criterion: "affordability", by: "factor", value: 1.5 },
  ]);

  // Employment 15 → 30, affordability 30 → 45: 75 named. The other four (55) are scaled to 25.
  assertShares(criteria.weights, {
    affordability: 45,
    schufa: (20 * 25) / 55,
    documents: (15 * 25) / 55,
    credibility: (15 * 25) / 55,
    employment: 30,
    previousLandlord: (5 * 25) / 55,
  });
});

test("factor 0 ignores a criterion", () => {
  const { criteria } = setup().adjust([{ criterion: "documents", by: "factor", value: 0 }]);

  // The other five (85) fill 100.
  assertShares(criteria.weights, {
    affordability: 3000 / 85,
    schufa: 2000 / 85,
    documents: 0,
    credibility: 1500 / 85,
    employment: 1500 / 85,
    previousLandlord: 500 / 85,
  });
});

test("a share already at 50 % asked × 2 stays at 50 % and is reported capped", () => {
  const saved = { affordability: 50, schufa: 20, documents: 10, credibility: 10, employment: 5, previousLandlord: 5 };
  const { adjust } = setup(saved);

  const { criteria, applied } = adjust([{ criterion: "affordability", by: "factor", value: 2 }]);

  assert.deepEqual(applied, [{ criterion: "affordability", from: 50, requested: 100, to: 50, capped: true }]);
  assertShares(criteria.weights, saved);
});

test("a weight at 90 % asked × 2 ends at 50 %", () => {
  // Possible after the classic page's sliders, which have no cap.
  const { adjust } = setup({ ...zeroes, affordability: 90, schufa: 10 });

  const { criteria, applied } = adjust([{ criterion: "affordability", by: "factor", value: 2 }]);

  assert.deepEqual(applied, [{ criterion: "affordability", from: 90, requested: 180, to: 50, capped: true }]);
  // SCHUFA, the only other criterion above 0, fills the other 50.
  assertShares(criteria.weights, { ...zeroes, affordability: 50, schufa: 50 });
});

test("a target share above 50 % is capped", () => {
  const { criteria, applied } = setup().adjust([{ criterion: "employment", by: "share", value: 70 }]);

  assert.deepEqual(applied, [{ criterion: "employment", from: 15, requested: 70, to: 50, capped: true }]);
  // The other five (85) scaled to 50.
  assert.ok(Math.abs(criteria.weights.affordability - (30 * 50) / 85) < 1e-9);
});

test("a request of exactly 50 % is applied as asked, not reported as capped", () => {
  // SCHUFA 20 × 2.5 = 50: at the limit, not above it; the chat must not say it hit the limit.
  const { applied } = setup().adjust([{ criterion: "schufa", by: "factor", value: 2.5 }]);

  assert.deepEqual(applied, [{ criterion: "schufa", from: 20, requested: 50, to: 50, capped: false }]);
});

test("the saved weights are read as shares of their sum", () => {
  // Saved weights that do not sum to 100 (the store holds what it was given).
  const { criteria, applied } = setup({ ...zeroes, affordability: 3, schufa: 1 }).adjust([{ criterion: "schufa", by: "share", value: 40 }]);

  assert.deepEqual(applied, [{ criterion: "schufa", from: 25, requested: 40, to: 40, capped: false }]);
  assertShares(criteria.weights, { ...zeroes, affordability: 60, schufa: 40 });
});

test("an unnamed share already above 50 % may shrink towards the limit", () => {
  const { criteria } = setup({ ...zeroes, affordability: 70, schufa: 10, documents: 10, credibility: 10 }).adjust([
    { criterion: "schufa", by: "share", value: 20 },
  ]);

  // The other three (90) scaled to 80: affordability 70 → 62.2.
  assertShares(criteria.weights, { ...zeroes, affordability: (70 * 80) / 90, schufa: 20, documents: (10 * 80) / 90, credibility: (10 * 80) / 90 });
});

// Each refusal: [why, saved weights (null: the defaults), changes, the detail's code].
const REFUSALS = [
  ["an unknown criterion", null, [{ criterion: "nationality", by: "factor", value: 2 }], "invalid_value"],
  ["no change", null, [], "too_small"],
  ["a change without its value", null, [{ criterion: "schufa", by: "factor" }], "invalid_type"],
  ["neither a factor nor a share", null, [{ criterion: "schufa", by: "percent", value: 30 }], "invalid_value"],
  // What the live model sent: a filled-in share next to the factor it meant.
  ["a factor and a share in one change", null, [{ criterion: "schufa", by: "factor", value: 1.3, share: 0 }], "unrecognized_keys"],
  ["a negative factor", null, [{ criterion: "schufa", by: "factor", value: -1 }], "too_small"],
  ["a share above 100", null, [{ criterion: "schufa", by: "share", value: 120 }], "too_big"],
  ["a criterion named twice", null, [{ criterion: "schufa", by: "factor", value: 2 }, { criterion: "schufa", by: "share", value: 10 }], "duplicate_criterion"],
  [
    "named shares above 100 % together",
    null,
    [{ criterion: "schufa", by: "share", value: 40 }, { criterion: "documents", by: "share", value: 40 }, { criterion: "credibility", by: "share", value: 40 }],
    "over_total",
  ],
  // Every criterion not named is at 0: nothing can fill the other 20 %.
  ["nothing to fill the rest", { ...zeroes, affordability: 50, schufa: 50 }, [{ criterion: "affordability", by: "share", value: 40 }, { criterion: "schufa", by: "share", value: 40 }], "rest_unfilled"],
  // Only affordability (30) and previous landlord (5) are left to fill 100: affordability 85.7 %.
  [
    "an unnamed share pushed above 50 %",
    null,
    ["schufa", "documents", "credibility", "employment"].map((criterion) => ({ criterion, by: "factor", value: 0 })),
    "above_limit",
  ],
  // Affordability stays at 100 %: the only criterion above 0.
  ["one criterion alone", { ...zeroes, affordability: 100 }, [{ criterion: "schufa", by: "factor", value: 2 }], "too_few_criteria"],
];

test("refusals are input errors naming the problem, and nothing is saved", () => {
  for (const [why, saved, changes, code] of REFUSALS) {
    const { store, landlordId, adjust } = setup(saved ?? undefined);
    const before = store.getCriteria(landlordId);
    assert.throws(
      () => adjust(changes),
      (error) => error instanceof CriteriaInputError && error.details.some((detail) => detail.code === code),
      why,
    );
    assert.deepEqual(store.getCriteria(landlordId), before, `${why}: nothing saved`);
  }
});

test("the refusals' messages say what the landlord can do", () => {
  const messageOf = (saved, changes) => {
    try {
      setup(saved ?? undefined).adjust(changes);
    } catch (error) {
      return error.details.map(({ message }) => message).join(" ");
    }
    assert.fail("not refused");
  };
  assert.match(messageOf({ ...zeroes, affordability: 50, schufa: 50 }, [{ criterion: "affordability", by: "share", value: 40 }, { criterion: "schufa", by: "share", value: 40 }]), /name .*fill/i);
  assert.match(messageOf(null, REFUSALS.at(-2)[2]), /affordability.*85\.7 %.*50 %/);
  assert.match(messageOf({ ...zeroes, affordability: 100 }, [{ criterion: "schufa", by: "factor", value: 2 }]), /at least two/i);
});
