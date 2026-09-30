import test from "node:test";
import assert from "node:assert/strict";
import { incomeFromRatio, incomeLineView, incomeScale, ratioPercent } from "../../public/landlord/income-line.js";

test("the scale runs from 0 to 5 × the rent, rounded to its step; the step grows with the rent", () => {
  assert.deepEqual(incomeScale(1000), { min: 0, max: 5000, step: 10 });
  assert.deepEqual(incomeScale(733), { min: 0, max: 3670, step: 10 });
  assert.deepEqual(incomeScale(2400), { min: 0, max: 12000, step: 50 });
});

test("an income above the rent: the distance is what is left, drawn from the rent to the income", () => {
  const view = incomeLineView({ rent: 1000, income: 1500 });
  assert.equal(view.relation, "above");
  assert.equal(view.difference, 500);
  assert.equal(view.rentPercent, 20);
  assert.equal(view.incomePercent, 30);
  assert.deepEqual([view.spanStart, view.spanEnd], [20, 30]);
});

test("an income below the rent is a shortfall, drawn from the income to the rent; equal is neither", () => {
  const below = incomeLineView({ rent: 1000, income: 800 });
  assert.equal(below.relation, "below");
  assert.equal(below.difference, -200);
  assert.deepEqual([below.spanStart, below.spanEnd], [16, 20]);

  assert.equal(incomeLineView({ rent: 1000, income: 1000 }).relation, "equal");
});

test("an income outside the scale is pinned to its ends", () => {
  assert.equal(incomeLineView({ rent: 1000, income: 9000 }).incomePercent, 100);
  assert.equal(incomeLineView({ rent: 1000, income: -5 }).incomePercent, 0);
});

test("the income ↔ the saved rent-to-income ratio (as a percentage for the form)", () => {
  assert.equal(ratioPercent(1000, 3000), "33.3333");
  assert.equal(ratioPercent(1000, 1000), "100");
  assert.equal(incomeFromRatio(1000, 1 / 3), 3000);
  assert.equal(incomeFromRatio(1000, 0.333333), 3000);
  assert.equal(incomeFromRatio(733, 0.4), 1833);
});
