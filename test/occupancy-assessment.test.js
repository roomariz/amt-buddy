import test from "node:test";
import assert from "node:assert/strict";

import { assessOccupancy, OccupancyInputError } from "../src/occupancy-assessment.js";

test("assesses the whole-dwelling minimum under section 7(1)", () => {
  assert.deepEqual(
    assessOccupancy({
      livingAreaSqm: 24,
      rooms: 2,
      occupants: 3,
      childrenUpToSix: 1,
    }),
    {
      status: "meets_minimum",
      meetsMinimum: true,
      livingAreaSqm: 24,
      requiredAreaSqm: 24,
      areaMarginSqm: 0,
      occupants: 3,
      childrenUpToSix: 1,
      rooms: 2,
      occupantsPerRoom: 1.5,
      roomsPerOccupant: 0.67,
      legalBasis: "§ 7 Abs. 1 WoAufG Bln",
      informationalOnly: true,
    },
  );
});

test("flags insufficient floor area", () => {
  const result = assessOccupancy({
    livingAreaSqm: 26,
    rooms: 2,
    occupants: 3,
    childrenUpToSix: 0,
  });

  assert.equal(result.status, "below_minimum");
  assert.equal(result.meetsMinimum, false);
  assert.equal(result.requiredAreaSqm, 27);
  assert.equal(result.areaMarginSqm, -1);
});

test("returns not assessed when dwelling facts are omitted", () => {
  assert.deepEqual(assessOccupancy({}), {
    status: "not_assessed",
    reason: "Dwelling and occupancy details were not provided.",
  });
});

test("rejects incomplete occupancy details", () => {
  assert.throws(
    () => assessOccupancy({ livingAreaSqm: 50, occupants: 2 }),
    (error) =>
      error instanceof OccupancyInputError &&
      error.details.some((detail) => detail.field === "rooms"),
  );
});
