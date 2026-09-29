import test from "node:test";
import assert from "node:assert/strict";

import { checkLandlordAnswer, stripUngroundedFigures } from "../../src/landlord/orchestrator/grounding.js";

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

test("a lead-in whose list items all had an ungrounded figure goes with them", () => {
  const answer = "Current top applicants (now calculated including affordability):\n- A-022: Match score 83.2\n- A-032: Match score 80.1\n\nShall I add them to the Shortlist?";
  assert.equal(stripUngroundedFigures(answer, ["83.2", "80.1"]), "Shall I add them to the Shortlist?");
  // Between two paragraphs: one blank line stays between them.
  assert.equal(stripUngroundedFigures("A-022 leads.\n\nThe new top:\n- A-022: 83.2\n\nShall I add A-022?", ["83.2"]), "A-022 leads.\n\nShall I add A-022?");
  // At the end of the answer, in markdown bold.
  assert.equal(stripUngroundedFigures("Your pool has A-022 on top.\n**Top applicants:**\n1. A-022 with 83.2", ["83.2"]), "Your pool has A-022 on top.");
});

test("a lead-in whose list survives stays, also when a blank line separates them", () => {
  const answer = "Top applicants:\n- A-022: Match score 83.2\n- A-032: Match score 99.9\n\nThe median rent is 598 €.";
  assert.equal(stripUngroundedFigures(answer, ["99.9"]), "Top applicants:\n- A-022: Match score 83.2\n\nThe median rent is 598 €.");
  const separated = "Top applicants:\n\n- A-022: Match score 83.2\n\nThe asking rent is 999 €.";
  assert.equal(stripUngroundedFigures(separated, ["999"]), "Top applicants:\n\n- A-022: Match score 83.2");
});

test("an answer with nothing to strip is unchanged, lead-ins included", () => {
  const answer = "Top applicants:\n- A-022: Match score 83.2\n\nWhat should I compare next:\n\nOr shall I add A-022 to the Shortlist:";
  assert.equal(stripUngroundedFigures(answer, []), answer);
  assert.equal(stripUngroundedFigures(answer, ["12.5"]), answer);
});
