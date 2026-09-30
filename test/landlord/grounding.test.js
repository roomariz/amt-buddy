import test from "node:test";
import assert from "node:assert/strict";

import { checkLandlordAnswer, stripUngroundedFigures } from "../../src/landlord/orchestrator/grounding.js";

const ranking = { result: { top: [{ applicantId: "A-003", rentToIncome: 0.1933 }] } };

test("a rentToIncome ratio from this turn's Tool results grounds its percentage, to one decimal and whole", () => {
  for (const answer of ["A-003 pays 19.3 % of income.", "A-003 pays 19 % of income."]) {
    assert.deepEqual(checkLandlordAnswer(answer, { evidence: [ranking] }), { grounded: true, ungrounded: [] }, answer);
  }
});

test("a ratio written with three decimals is its true value (0.193 for 0.1933), and no stray 333 is grounded", () => {
  // The shared parser reads "0.193" as 0.19 (a leading 0 is never a thousands group); the ratio
  // 0.1933 is known as 0.19 too, so the figure grounds. Nothing reads as 333 any more.
  assert.deepEqual(checkLandlordAnswer("A-003 pays 0.193 of income.", { evidence: [ranking] }), { grounded: true, ungrounded: [] });
  const context = { stats: { total: 40, maxRentToIncome: 1 / 3 } };
  assert.deepEqual(checkLandlordAnswer("333 applicants applied.", { context }), { grounded: false, ungrounded: ["333"] });
});

test("the context's maxRentToIncome grounds 33.3 % only, not a whole 33 an answer could invent", () => {
  // Nothing else in the context is 33 or rounds to it (total 40, 12 clean, 1/3 → 0.33).
  const context = { stats: { total: 40, cleanSchufa: 12, maxRentToIncome: 1 / 3 }, preferences: { requirements: { maxRentToIncome: 1 / 3 } } };
  assert.deepEqual(checkLandlordAnswer("About 33 % of applicants can afford it.", { context }), { grounded: false, ungrounded: ["33"] });
  assert.deepEqual(checkLandlordAnswer("The limit is 33.3 % of income; 12 have a clean SCHUFA.", { context }), { grounded: true, ungrounded: [] });
});

test("a maxRentToIncome in this turn's Tool results grounds 33.3 % only too: the whole percent is an applicant's ratio's", () => {
  const evidence = [{ result: { stats: { total: 40, maxRentToIncome: 1 / 3 } } }];
  assert.deepEqual(checkLandlordAnswer("About 33 % of applicants can afford it.", { evidence }), { grounded: false, ungrounded: ["33"] });
  assert.deepEqual(checkLandlordAnswer("The limit is 33.3 % of income.", { evidence }), { grounded: true, ungrounded: [] });
});

test("a rentToIncome in the context grounds its one-decimal percentage, not the whole one", () => {
  const context = { top: [{ applicantId: "A-003", rank: 1, matchScore: 80.1, rentToIncome: 0.1933 }] };
  assert.deepEqual(checkLandlordAnswer("A-003 pays 19.3 % of income.", { context }), { grounded: true, ungrounded: [] });
  assert.deepEqual(checkLandlordAnswer("A-003 pays 19 % of income.", { context }), { grounded: false, ungrounded: ["19"] });
});

test("a ratio grounds only its own written forms, not a neighbouring figure", () => {
  const { ungrounded } = checkLandlordAnswer("A-003 pays 19.4 % of income.", { evidence: [ranking] });
  assert.deepEqual(ungrounded, ["19.4"]);
});

// Known limit, accepted: the shared parser rounds to cents, so a ratio written as a decimal is
// checked to two places only — 0.194 and 0.1933 are both 0.19. The prompt has the chat write
// ratios as percentages (checked to one decimal, above); a finer check would need the parser to
// stop rounding, in code the tenant chat shares.
test("a ratio written as a decimal is checked to cents only (known limit)", () => {
  assert.deepEqual(checkLandlordAnswer("A-003 pays 0.194 of income.", { evidence: [ranking] }), { grounded: true, ungrounded: [] });
  assert.deepEqual(checkLandlordAnswer("A-003 pays 0.21 of income.", { evidence: [ranking] }), { grounded: false, ungrounded: ["0.21"] });
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
