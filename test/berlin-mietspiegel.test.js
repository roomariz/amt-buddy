import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateAdjustedMietspiegelRent,
  calculateMietspiegelWeight,
  evaluateMietspiegel,
  normalizeBuildingAgeCategory,
  getSizeCategory,
} from "../src/berlin-mietspiegel.js";

const exampleSpan = { lower: 5.9, median: 7.3, upper: 9.55 };
const featureGroups = {
  bathroom: "positive",
  kitchen: "positive",
  apartment: "positive",
  building: "negative",
  surroundings: "negative",
};

test("adjusts the Mietspiegel span above and below the median", () => {
  assert.equal(calculateAdjustedMietspiegelRent({ ...exampleSpan, weightPercent: 20 }), 7.75);
  assert.equal(calculateAdjustedMietspiegelRent({ ...exampleSpan, weightPercent: -20 }), 7.02);
});

test("span adjustment reaches the bounds and preserves the median at zero", () => {
  assert.equal(calculateAdjustedMietspiegelRent({ ...exampleSpan, weightPercent: 100 }), 9.55);
  assert.equal(calculateAdjustedMietspiegelRent({ ...exampleSpan, weightPercent: -100 }), 5.9);
  assert.equal(calculateAdjustedMietspiegelRent({ ...exampleSpan, weightPercent: 0 }), 7.3);
});

test("aggregates the five semantic feature groups", () => {
  assert.equal(calculateMietspiegelWeight(featureGroups), 20);
  assert.equal(calculateMietspiegelWeight(Object.fromEntries(
    Object.keys(featureGroups).map((group) => [group, "neutral"]),
  )), 0);
});

test("rejects invalid, missing, and unknown feature groups", () => {
  assert.throws(() => calculateMietspiegelWeight({ ...featureGroups, kitchen: "good" }), /Invalid value/);
  assert.throws(() => calculateMietspiegelWeight({ ...featureGroups, kitchen: 20 }), /Invalid value/);
  const { bathroom, ...incompleteGroups } = featureGroups;
  assert.throws(() => calculateMietspiegelWeight(incompleteGroups), /Missing feature group/);
  assert.throws(() => calculateMietspiegelWeight({ ...featureGroups, location: "neutral" }), /Unknown feature group/);
});

test("rejects invalid span ordering, out-of-range weights, and non-finite numbers", () => {
  assert.throws(() => calculateAdjustedMietspiegelRent({ lower: 8, median: 7.3, upper: 9.55, weightPercent: 20 }), /lower <= median <= upper/);
  assert.throws(() => calculateAdjustedMietspiegelRent({ ...exampleSpan, weightPercent: 101 }), /between -100 and 100/);
  assert.throws(() => calculateAdjustedMietspiegelRent({ ...exampleSpan, weightPercent: -101 }), /between -100 and 100/);
  assert.throws(() => calculateAdjustedMietspiegelRent({ ...exampleSpan, weightPercent: Infinity }), /finite numbers/);
});

test("normalizes building age strings and years to Mietspiegel categories", () => {
  assert.equal(normalizeBuildingAgeCategory(1910), "bis 1918");
  assert.equal(normalizeBuildingAgeCategory(1935), "1919–1949");
  assert.equal(normalizeBuildingAgeCategory(1955), "1950–1964");
  assert.equal(normalizeBuildingAgeCategory(1968), "1965–1972");
  assert.equal(normalizeBuildingAgeCategory(1985), "1973–1990");
  assert.equal(normalizeBuildingAgeCategory(1998), "1991–2001");
  assert.equal(normalizeBuildingAgeCategory(2005), "2002–2009");
  assert.equal(normalizeBuildingAgeCategory(2014), "ab 2010");

  assert.equal(normalizeBuildingAgeCategory("bis 1900"), "bis 1918");
  assert.equal(normalizeBuildingAgeCategory("1921-1930"), "1919–1949");
  assert.equal(normalizeBuildingAgeCategory("1951-1960"), "1950–1964");
  assert.equal(normalizeBuildingAgeCategory("1961-1970"), "1965–1972");
  assert.equal(normalizeBuildingAgeCategory("1981-1990"), "1973–1990");
  assert.equal(normalizeBuildingAgeCategory("2011-2015"), "ab 2010");
});

test("determines size category correctly", () => {
  assert.equal(getSizeCategory(35), "< 40 m²");
  assert.equal(getSizeCategory(50), "40–60 m²");
  assert.equal(getSizeCategory(75), "60–90 m²");
  assert.equal(getSizeCategory(110), "≥ 90 m²");
  assert.equal(getSizeCategory(0), null);
});

test("evaluates Mietspiegel reference rent matching prompt example (field D4)", () => {
  const result = evaluateMietspiegel({
    residentialLocation: "gut",
    buildingAgeOrYear: "1919–1949",
    livingAreaSqm: 50,
  });

  assert.equal(result.status, "calculated");
  assert.equal(result.buildingAge, "1919–1949");
  assert.equal(result.residentialLocation, "gut");
  assert.equal(result.sizeCategory, "40–60 m²");
  assert.equal(result.field, "D4");
  assert.deepEqual(result.rentPerSqm, {
    lower: 8.2,
    median: 9.45,
    upper: 11.1,
  });
  assert.deepEqual(result.monthlyReferenceRent, {
    lower: 410.0,
    median: 472.5,
    upper: 555.0,
  });
  assert.equal(result.currency, "EUR");
  assert.equal(result.basis, "net cold rent");
  assert.equal(result.contractRentComparison, null);
  assert.equal(Object.hasOwn(result, "adjustedReferenceRent"), false);
});

test("adds an adjusted reference rent without changing existing values", () => {
  const result = evaluateMietspiegel({
    residentialLocation: "gut",
    buildingAgeOrYear: "1919–1949",
    livingAreaSqm: 50,
    featureGroups,
  });

  assert.deepEqual(result.adjustedReferenceRent, {
    weightPercent: 20,
    rentPerSqm: 9.78,
    monthlyRent: 489,
  });
  assert.deepEqual(result.rentPerSqm, { lower: 8.2, median: 9.45, upper: 11.1 });
  assert.deepEqual(result.monthlyReferenceRent, { lower: 410, median: 472.5, upper: 555 });
});

test("calculates monthly rent before rounding the adjusted rent per square meter", () => {
  const result = evaluateMietspiegel({
    residentialLocation: "einfach",
    buildingAgeOrYear: "1919–1949",
    livingAreaSqm: 50,
    featureGroups,
  });

  assert.equal(result.field, "D1b");
  assert.equal(result.adjustedReferenceRent.rentPerSqm, 8.26);
  assert.equal(result.adjustedReferenceRent.monthlyRent, 412.9);
});

test("evaluates contractual rent comparison (below, within, above)", () => {
  const within = evaluateMietspiegel({
    residentialLocation: "gut",
    buildingAgeOrYear: "1919–1949",
    livingAreaSqm: 50,
    contractRent: 500,
  });
  assert.equal(within.contractRentComparison.status, "within");
  assert.equal(within.contractRentComparison.actualMonthlyRent, 500);
  assert.equal(within.contractRentComparison.actualRentPerSqm, 10);
  assert.equal(within.contractRentComparison.differenceFromMedian, 27.5);

  const below = evaluateMietspiegel({
    residentialLocation: "gut",
    buildingAgeOrYear: "1919–1949",
    livingAreaSqm: 50,
    contractRent: 350,
  });
  assert.equal(below.contractRentComparison.status, "below");
  assert.equal(below.contractRentComparison.differenceFromThreshold, -60);

  const above = evaluateMietspiegel({
    residentialLocation: "gut",
    buildingAgeOrYear: "1919–1949",
    livingAreaSqm: 50,
    contractRent: 650,
  });
  assert.equal(above.contractRentComparison.status, "above");
  assert.equal(above.contractRentComparison.differenceFromThreshold, 95);
});

test("reports missing living area or missing building age", () => {
  const noSize = evaluateMietspiegel({
    residentialLocation: "gut",
    buildingAgeOrYear: "1919–1949",
  });
  assert.equal(noSize.status, "missing_dwelling_size");

  const noAge = evaluateMietspiegel({
    residentialLocation: "gut",
    livingAreaSqm: 50,
  });
  assert.equal(noAge.status, "missing_building_age");
});

// Field D4 (gut, 1919–1949, 50 m²): median 472.50 € a month, so Mietspiegel + 10 % = 519.75 €.
const rentCapFlat = { residentialLocation: "gut", buildingAgeOrYear: "1919–1949", livingAreaSqm: 50 };

test("rented before without a previous rent: the cap is Mietspiegel + 10 %, conditionally", () => {
  const { rentCap } = evaluateMietspiegel({ ...rentCapFlat, contractRent: 780, rentedBefore: true });

  assert.equal(rentCap.basis, "mietspiegel_plus_10");
  assert.equal(rentCap.capPercent, 10);
  assert.equal(rentCap.referenceMonthlyRent, 472.5);
  assert.equal(rentCap.baseCapMonthlyRent, 519.75);
  assert.equal(rentCap.capMonthlyRent, 519.75);
  assert.equal(rentCap.conditional, true);
  assert.equal(rentCap.status, "above_cap");
  assert.equal(rentCap.differenceFromCap, 260.25);
});

test("rented before with a higher previous rent: the previous rent is the cap, unconditionally", () => {
  const { rentCap } = evaluateMietspiegel({ ...rentCapFlat, contractRent: 780, rentedBefore: true, previousRent: 950 });

  assert.equal(rentCap.basis, "previous_rent");
  assert.equal(rentCap.baseCapMonthlyRent, 519.75);
  assert.equal(rentCap.capMonthlyRent, 950);
  assert.equal(rentCap.conditional, false);
  assert.equal(rentCap.status, "within_cap");
  assert.equal(rentCap.differenceFromCap, -170);
});

test("rented before with a previous rent up to Mietspiegel + 10 %: the cap stays Mietspiegel + 10 %, unconditionally", () => {
  for (const previousRent of [400, 519.75]) {
    const { rentCap } = evaluateMietspiegel({ ...rentCapFlat, contractRent: 780, rentedBefore: true, previousRent });

    assert.equal(rentCap.basis, "mietspiegel_plus_10", String(previousRent));
    assert.equal(rentCap.capMonthlyRent, 519.75, String(previousRent));
    assert.equal(rentCap.conditional, false, String(previousRent));
    assert.equal(rentCap.status, "above_cap", String(previousRent));
    assert.equal(rentCap.differenceFromCap, 260.25, String(previousRent));
  }
});

test("never rented: the cap is Mietspiegel + 10 %, unconditionally", () => {
  const { rentCap } = evaluateMietspiegel({ ...rentCapFlat, contractRent: 500, rentedBefore: false });

  assert.equal(rentCap.basis, "mietspiegel_plus_10");
  assert.equal(rentCap.capMonthlyRent, 519.75);
  assert.equal(rentCap.conditional, false);
  assert.equal(rentCap.status, "within_cap");
  assert.equal(rentCap.differenceFromCap, -19.75);
});

test("a contract rent equal to the cap is within the cap", () => {
  const { rentCap } = evaluateMietspiegel({ ...rentCapFlat, contractRent: 519.75, rentedBefore: true });

  assert.equal(rentCap.status, "within_cap");
  assert.equal(rentCap.differenceFromCap, 0);
});

test("with all five ratings the cap is based on the Adjusted reference rent", () => {
  // Adjusted reference rent 489 € a month (see above): 489 × 1.10 = 537.90 €.
  const { rentCap } = evaluateMietspiegel({ ...rentCapFlat, contractRent: 540, rentedBefore: false, featureGroups });

  assert.equal(rentCap.referenceMonthlyRent, 489);
  assert.equal(rentCap.baseCapMonthlyRent, 537.9);
  assert.equal(rentCap.capMonthlyRent, 537.9);
  assert.equal(rentCap.status, "above_cap");
  assert.equal(rentCap.differenceFromCap, 2.1);
});

test("there is no rent cap without 'rented before' or without a contract rent", () => {
  const withoutRentedBefore = evaluateMietspiegel({ ...rentCapFlat, contractRent: 780 });
  const withoutContractRent = evaluateMietspiegel({ ...rentCapFlat, rentedBefore: true });

  assert.equal(Object.hasOwn(withoutRentedBefore, "rentCap"), false);
  assert.equal(Object.hasOwn(withoutContractRent, "rentCap"), false);
  assert.deepEqual(
    evaluateMietspiegel({ ...rentCapFlat, contractRent: 780, rentedBefore: true }).contractRentComparison,
    withoutRentedBefore.contractRentComparison,
    "the range comparison is unchanged",
  );
});

test("the rent cap's legal texts name the 10 %, 1 October 2014 and 1 June 2015", () => {
  const { rentCap } = evaluateMietspiegel({ ...rentCapFlat, contractRent: 780, rentedBefore: true });

  assert.match(rentCap.legalBasis, /§§ 556d–556g BGB/);
  assert.match(rentCap.legalBasis, /10 %/);
  assert.match(rentCap.legalBasis, /1 October 2014/);
  assert.match(rentCap.legalBasis, /§ 556g BGB/);
  assert.match(rentCap.notChecked, /1 June 2015/);
  assert.match(rentCap.notChecked, /start of the lease/);
});
