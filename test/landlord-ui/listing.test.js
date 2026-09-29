import test from "node:test";
import assert from "node:assert/strict";

import { listingFormValues, listingRequest, rentCheckView } from "../../public/landlord/listing.js";

// The Rent check the server returns for Wühlischstraße 30, 50 m², 700 € (see test/landlord/server.test.js).
const ABOVE_CAP = {
  askingRent: 700,
  range: { lower: 420, median: 490, upper: 610 },
  position: "high",
  aboveCap: true,
  allowedRent: 539,
  differenceFromAllowed: 161,
};

test("the form's text fields become the Listing request, with German or English decimals", () => {
  assert.deepEqual(
    listingRequest({ address: " Wühlischstraße 30, 10245 Berlin ", livingAreaSqm: "52,5", rooms: "2.5", askingRent: "700", buildingYear: "" }),
    { address: "Wühlischstraße 30, 10245 Berlin", livingAreaSqm: 52.5, rooms: 2.5, askingRent: 700 },
  );
  assert.equal(listingRequest({ address: "x", livingAreaSqm: "50", rooms: "2", askingRent: "1.200,50", buildingYear: "1955" }).askingRent, 1200.5);
  assert.equal(listingRequest({ address: "x", livingAreaSqm: "50", rooms: "2", askingRent: "700", buildingYear: "1955" }).buildingYear, 1955);
  assert.equal(listingRequest({ address: "x", livingAreaSqm: "50", rooms: "2", askingRent: "1.200", buildingYear: "" }).askingRent, 1200, "German thousands");
  assert.equal(listingRequest({ address: "x", livingAreaSqm: "50", rooms: "2", askingRent: "1.234.567", buildingYear: "" }).askingRent, 1234567);
});

test("a field that is not a number is sent as it is, so the server names it", () => {
  const request = listingRequest({ address: "x", livingAreaSqm: "fifty", rooms: "", askingRent: "700", buildingYear: "old" });
  assert.equal(request.livingAreaSqm, "fifty");
  assert.equal(request.rooms, "");
  assert.equal(request.buildingYear, "old");
});

test("a saved Listing fills the form again", () => {
  assert.deepEqual(
    listingFormValues({ address: "Wühlischstraße 30, 10245 Berlin", livingAreaSqm: 52.5, rooms: 2, askingRent: 700, buildingYear: null }),
    { address: "Wühlischstraße 30, 10245 Berlin", livingAreaSqm: "52.5", rooms: "2", askingRent: "700", buildingYear: "" },
  );
  assert.deepEqual(listingFormValues(null), { address: "", livingAreaSqm: "", rooms: "", askingRent: "", buildingYear: "" });
});

test("the range bar orders lower, median, upper and places an asking rent above the range to their right", () => {
  const view = rentCheckView(ABOVE_CAP);
  const marks = [view.lowerPercent, view.medianPercent, view.allowedPercent, view.upperPercent, view.askingPercent];
  for (const mark of marks) assert.ok(mark >= 0 && mark <= 100, `${mark} is on the bar`);
  assert.ok(view.lowerPercent < view.medianPercent);
  assert.ok(view.medianPercent < view.allowedPercent, "Mietspiegel + 10 % sits right of the median");
  assert.ok(view.allowedPercent < view.upperPercent);
  assert.ok(view.askingPercent > view.upperPercent);
});

test("an asking rent below the range sits left of the lower bound", () => {
  const view = rentCheckView({ ...ABOVE_CAP, askingRent: 350, position: "low", aboveCap: false, differenceFromAllowed: -189 });
  assert.ok(view.askingPercent < view.lowerPercent);
  assert.ok(view.askingPercent >= 0);
});

test("the warning with the allowed rent shows only when the asking rent is above Mietspiegel + 10 %", () => {
  assert.deepEqual(rentCheckView(ABOVE_CAP).warning, { allowedRent: 539, excess: 161 });
  assert.equal(rentCheckView({ ...ABOVE_CAP, askingRent: 530, position: "typical", aboveCap: false, differenceFromAllowed: -9 }).warning, null);
  assert.equal(rentCheckView(ABOVE_CAP).position, "high");
});
