import test from "node:test";
import assert from "node:assert/strict";

import { parseNumber } from "../../src/orchestrator/numbers.js";

// parseNumber reads German and English notation, rounded to cents (its header comment). The
// expected values follow from how the numbers are written, not from running the parser.

test("German and English thousands separators and decimals", () => {
  assert.equal(parseNumber("1.100"), 1100);
  assert.equal(parseNumber("100.000"), 100000);
  assert.equal(parseNumber("1.234.567"), 1234567);
  assert.equal(parseNumber("1,100"), 1100);
  assert.equal(parseNumber("1.100,50"), 1100.5);
  assert.equal(parseNumber("1,100.50"), 1100.5);
  assert.equal(parseNumber("720,50"), 720.5);
  assert.equal(parseNumber("9.20"), 9.2);
  assert.equal(parseNumber("19.3"), 19.3);
});

// A thousands group never follows a leading 0: "0.249" (English) and "0,249" (German) are both
// the decimal 0.249. Read as a thousands separator they became 249, so a ratio an answer quoted
// could never be grounded (seen live, 2026-09-30).
test("a leading 0 before . or , is always a decimal, never a thousands group", () => {
  assert.equal(parseNumber("0.249"), 0.25);
  assert.equal(parseNumber("0,249"), 0.25);
  assert.equal(parseNumber("0.333"), 0.33);
  assert.equal(parseNumber("0.19"), 0.19);
});

test("rounded to cents: more decimals are rounded, not kept", () => {
  assert.equal(parseNumber("0.1933"), 0.19);
  assert.equal(parseNumber("16.9234"), 16.92);
});

// "16.923" stays a thousands number: German writes sixteen thousand nine hundred twenty-three
// that way, so only the leading 0 is unambiguous.
test("a dot and three digits after a non-zero group is still a German thousands separator", () => {
  assert.equal(parseNumber("16.923"), 16923);
});

test("not a number: null", () => {
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber("abc"), null);
});
