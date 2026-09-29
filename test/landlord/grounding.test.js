import test from "node:test";
import assert from "node:assert/strict";

import { checkLandlordAnswer } from "../../src/landlord/orchestrator/grounding.js";

const ranking = { result: { top: [{ applicantId: "A-003", rentToIncome: 0.1933 }] } };

test("a rentToIncome ratio grounds its percentage and its three-decimal form", () => {
  for (const answer of ["A-003 pays 19.3 % of income.", "A-003 pays 0.193 of income.", "A-003 pays 19 % of income."]) {
    assert.deepEqual(checkLandlordAnswer(answer, { evidence: [ranking] }), { grounded: true, ungrounded: [] }, answer);
  }
});

test("a ratio grounds only its own written forms, not a neighbouring figure", () => {
  const { ungrounded } = checkLandlordAnswer("A-003 pays 19.4 % of income, or 0.194.", { evidence: [ranking] });
  assert.deepEqual(ungrounded, ["19.4", "0.194"]);
});

test("a subscore of 0.5 without a ratio key does not ground 50 %", () => {
  const evidence = [{ result: { breakdown: { schufa: { subscore: 0.5, weight: 26 } } } }];
  assert.deepEqual(checkLandlordAnswer("The rent is 50 % of income.", { evidence }), { grounded: false, ungrounded: ["50"] });
});

test("maxRentToIncome in the context grounds its percentage", () => {
  const context = { preferences: { requirements: { maxRentToIncome: 1 / 3 } } };
  assert.deepEqual(checkLandlordAnswer("Your limit is 33.3 % of income.", { context }), { grounded: true, ungrounded: [] });
});
