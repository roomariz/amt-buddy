import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateMietspiegel,
  normalizeBuildingAgeCategory,
  getSizeCategory,
} from "../src/berlin-mietspiegel.js";

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
