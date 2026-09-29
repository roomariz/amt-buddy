import test from "node:test";
import assert from "node:assert/strict";
import { criteriaFormValues, criteriaRequest } from "../../public/landlord/criteria.js";

const criteria = {
  weights: { affordability: 30, schufa: 20, documents: 15, credibility: 15, employment: 15, previousLandlord: 5 },
  requirements: { schufaCleanOnly: false, completeDocumentsOnly: false, maxRentToIncome: null, noPets: false, noSmoking: false, latestMoveIn: null, occupancyCompliant: true },
};

test("criteria controls become numeric weights, boolean requirements, a ratio and a date", () => {
  const form = criteriaFormValues(criteria);
  const request = criteriaRequest({ ...form, affordability: "60", noPets: "on", maxRentToIncome: "33,5", latestMoveIn: "2026-12-01" });
  assert.deepEqual(request, {
    weights: { affordability: 60, schufa: 20, documents: 15, credibility: 15, employment: 15, previousLandlord: 5 },
    requirements: { ...criteria.requirements, noPets: true, maxRentToIncome: 0.335, latestMoveIn: "2026-12-01" },
  });
});

test("blank optional fields and absent checkboxes clear earlier requirements", () => {
  const form = criteriaFormValues({ ...criteria, requirements: { ...criteria.requirements, noPets: true, latestMoveIn: "2026-12-01", maxRentToIncome: 0.4 } });
  delete form.noPets; // FormData omits unchecked checkboxes.
  const request = criteriaRequest({ ...form, latestMoveIn: "", maxRentToIncome: "" });
  assert.deepEqual(request.requirements, criteria.requirements);
});

test("invalid numeric input stays invalid so server validation can name the field", () => {
  const request = criteriaRequest({ ...criteriaFormValues(criteria), affordability: "", maxRentToIncome: "many" });
  assert.equal(request.weights.affordability, "");
  assert.equal(request.requirements.maxRentToIncome, "many");
});
