import test from "node:test";
import assert from "node:assert/strict";

import { applicantDetailView } from "../../public/landlord/applicant-detail.js";
import { setLanguage } from "../../public/i18n.js";

const detail = {
  profile: {
    id: "A-001", householdSize: 2, household: { adults: 2, children: 0, childrenUpToSix: 0 },
    netHouseholdIncome: 3500, employmentType: "fixed_term", schufaStatus: "minor_entries",
    moveInDate: "2026-12-15", pets: true, smoking: false, credibilityScore: 70,
    documentCheck: {
      schufa: { status: "expired", reason: "Issued too long ago." },
      incomeProof: { status: "inconsistent", reason: "Income mismatch." },
      previousLandlord: { status: "present", reason: null, arrears: false },
      complete: false,
      issues: [{ document: "schufa", code: "schufa_expired", message: "Issued too long ago." }, { document: "incomeProof", code: "income_mismatch", message: "Income mismatch." }],
    },
  },
  score: {
    applicantId: "A-001", rank: 2, matchScore: 74, rentToIncome: 0.2,
    breakdown: {
      affordability: { subscore: 1, weight: 30 }, schufa: { subscore: 0.5, weight: 20 },
      documents: { subscore: 0.33, weight: 15 }, credibility: { subscore: 0.7, weight: 15 },
      employment: { subscore: 0.6, weight: 15 }, previousLandlord: { subscore: 1, weight: 5 },
    },
  },
  rentToIncome: 0.2,
  contact: { name: "Ada Beispiel", email: "ada@example.org", phone: "+49 30 123" },
};

test("detail view labels profile, document states, issues and score in German and English", () => {
  try {
    for (const lang of ["de", "en"]) {
      setLanguage(lang);
      const view = applicantDetailView(detail);
      assert.equal(view.name, "Ada Beispiel");
      assert.equal(view.email, "ada@example.org");
      assert.equal(view.phone, "+49 30 123");
      assert.equal(view.facts.length, 9);
      assert.ok(view.facts.every(({ label, value }) => label && value && !label.startsWith("landlord.")));
      assert.equal(view.documents.length, 3);
      assert.ok(view.documents.every(({ label, status, reason }) => label && status && reason !== undefined));
      assert.equal(view.issues.length, 2);
      assert.equal(view.breakdown.length, 6);
      assert.ok(view.breakdown.every(({ label }) => label && !label.startsWith("landlord.")));
      assert.equal(view.exclusion, null);
    }
    setLanguage("de");
    assert.equal(applicantDetailView(detail).documents[0].status, "abgelaufen");
    setLanguage("en");
    assert.equal(applicantDetailView(detail).documents[0].status, "expired");
  } finally {
    setLanguage("de");
  }
});

test("an excluded applicant shows the translated reason instead of score breakdown", () => {
  try {
    setLanguage("en");
    const view = applicantDetailView({ ...detail, score: { applicantId: "A-001", excludedBy: "noPets", reasons: [{ requirement: "noPets", message: "The household has pets." }] } });
    assert.equal(view.exclusion, "The household has pets.");
    assert.deepEqual(view.breakdown, []);
    setLanguage("de");
    assert.equal(applicantDetailView({ ...detail, score: { applicantId: "A-001", excludedBy: "noPets", reasons: [{ requirement: "noPets" }] } }).exclusion, "Der Haushalt hat Haustiere.");
  } finally {
    setLanguage("de");
  }
});
