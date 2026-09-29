import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { readApplicantPool, summarizeApplicantPool } from "../../src/landlord/applicant-pool.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/applicants/", import.meta.url));
const TODAY = "2026-09-29";

async function readFixtures(today = TODAY) {
  const pool = await readApplicantPool(FIXTURES, { today });
  const byId = (id) => pool.applicants.find((applicant) => applicant.id === id);
  return { ...pool, byId };
}

test("a complete application gives a full Applicant profile, with name and contact beside it", async () => {
  const { byId } = await readFixtures();

  assert.deepEqual(byId("A-complete"), {
    id: "A-complete",
    contact: { name: "Lena Schmidt", email: "lena.schmidt@example.org", phone: "+49 30 1234567" },
    profile: {
      id: "A-complete",
      householdSize: 3,
      household: { adults: 2, children: 1, childrenUpToSix: 1 },
      netHouseholdIncome: 3800,
      employmentType: "permanent",
      schufaStatus: "clean",
      moveInDate: "2026-11-01",
      pets: false,
      smoking: false,
      documentCheck: {
        schufa: { status: "present", reason: null },
        incomeProof: { status: "present", reason: null },
        previousLandlord: { status: "present", reason: null, arrears: false },
        complete: true,
        issues: [],
      },
      credibilityScore: 100,
    },
  });
});

const issueCodes = (applicant) => applicant.profile.documentCheck.issues.map((issue) => issue.code);

test("an application without a SCHUFA-Auskunft is incomplete and loses credibility", async () => {
  const { profile } = (await readFixtures()).byId("A-no-schufa");

  assert.equal(profile.schufaStatus, "missing");
  assert.equal(profile.documentCheck.schufa.status, "missing");
  assert.equal(typeof profile.documentCheck.schufa.reason, "string");
  assert.equal(profile.documentCheck.complete, false);
  assert.deepEqual(issueCodes({ profile }), ["schufa_missing"]);
  assert.equal(profile.credibilityScore, 75);
});

test("a SCHUFA-Auskunft older than 3 months before today is expired", async () => {
  const { profile } = (await readFixtures()).byId("A-expired-schufa");

  assert.equal(profile.documentCheck.schufa.status, "expired");
  assert.match(profile.documentCheck.schufa.reason, /2026-05-10/);
  assert.equal(profile.schufaStatus, "clean", "the status is still read from the expired report");
  assert.equal(profile.documentCheck.complete, false);
  assert.deepEqual(issueCodes({ profile }), ["schufa_expired"]);
  assert.equal(profile.credibilityScore, 85);
});

test("a SCHUFA-Auskunft issued exactly 3 months before today is still current; a day more is expired", async () => {
  // The complete fixture's SCHUFA-Auskunft is issued on 2026-08-15.
  const statusOn = async (today) => (await readFixtures(today)).byId("A-complete").profile.documentCheck.schufa.status;

  assert.equal(await statusOn("2026-11-15"), "present");
  assert.equal(await statusOn("2026-11-16"), "expired");
  assert.equal(await statusOn(new Date("2026-11-15T12:00:00Z")), "present");
});

test("a SCHUFA-Auskunft dated after today cannot be right", async () => {
  // The fixture's SCHUFA-Auskunft is issued on 2027-02-28.
  const { profile } = (await readFixtures("2026-09-29")).byId("A-feb-schufa");

  assert.equal(profile.documentCheck.schufa.status, "inconsistent");
  assert.equal(profile.schufaStatus, "missing");
  assert.deepEqual(issueCodes({ profile }), ["schufa_unreadable"]);
});

test("'today' must be given, as a day or a Date", async () => {
  await assert.rejects(readApplicantPool(FIXTURES), TypeError);
  await assert.rejects(readApplicantPool(FIXTURES, { today: "2026-02-30" }), TypeError);
  await assert.rejects(readApplicantPool(FIXTURES, { today: new Date("nonsense") }), TypeError);
});

test("the 3 months end on the last day of a shorter month", async () => {
  // 3 months before 31 May is 28 February (there is no 31 February).
  const statusOn = async (today) => (await readFixtures(today)).byId("A-feb-schufa").profile.documentCheck.schufa.status;

  assert.equal(await statusOn("2027-05-31"), "present");
  assert.equal(await statusOn("2027-06-01"), "expired");
});

test("the SCHUFA status is read from the report's entries", async () => {
  const { byId } = await readFixtures();

  assert.equal(byId("A-complete").profile.schufaStatus, "clean");
  assert.equal(byId("A-minor-schufa").profile.schufaStatus, "minor_entries");
  const negative = byId("A-negative-schufa").profile;
  assert.equal(negative.schufaStatus, "negative");
  assert.equal(negative.documentCheck.complete, true, "negative entries are a finding, not a document problem");
  assert.equal(negative.credibilityScore, 100);
});

test("a SCHUFA-Auskunft whose entries cannot be read is inconsistent", async () => {
  const { profile } = (await readFixtures()).byId("A-unreadable-schufa");

  assert.equal(profile.schufaStatus, "missing");
  assert.equal(profile.documentCheck.schufa.status, "inconsistent");
  assert.deepEqual(issueCodes({ profile }), ["schufa_unreadable"]);
});

test("payslips averaging more than 10 % below the declared income are inconsistent", async () => {
  // Declared 3800 €, payslips 3290 € and 3310 €: 3300 € on average, 13 % below.
  const { profile } = (await readFixtures()).byId("A-low-income");

  assert.equal(profile.documentCheck.incomeProof.status, "inconsistent");
  assert.match(profile.documentCheck.incomeProof.reason, /3300/);
  assert.equal(profile.netHouseholdIncome, 3800, "the profile keeps the declared income");
  assert.deepEqual(issueCodes({ profile }), ["income_mismatch"]);
  assert.equal(profile.credibilityScore, 70);
});

test("payslips averaging exactly 10 % below the declared income still support it", async () => {
  // Declared 3800 €, payslips 3400 € and 3440 €: 3420 € on average, exactly 10 % below.
  const { profile } = (await readFixtures()).byId("A-income-at-limit");

  assert.equal(profile.documentCheck.incomeProof.status, "present");
  assert.deepEqual(issueCodes({ profile }), []);
});

test("an application without income proof is incomplete", async () => {
  const { profile } = (await readFixtures()).byId("A-no-income-proof");

  assert.equal(profile.documentCheck.incomeProof.status, "missing");
  assert.equal(profile.documentCheck.complete, false);
  assert.deepEqual(issueCodes({ profile }), ["income_proof_missing"]);
  assert.equal(profile.credibilityScore, 70);
});

test("a first-time renter needs no previous-landlord confirmation", async () => {
  const { profile } = (await readFixtures()).byId("A-first-flat");

  assert.deepEqual(profile.documentCheck.previousLandlord, {
    status: "not_required",
    reason: "First-time renter: there is no previous landlord.",
    arrears: null,
  });
  assert.equal(profile.documentCheck.complete, true);
  assert.equal(profile.credibilityScore, 100);
});

test("an applicant who rented before and has no previous-landlord confirmation is incomplete", async () => {
  const { profile } = (await readFixtures()).byId("A-no-confirmation");

  assert.equal(profile.documentCheck.previousLandlord.status, "missing");
  assert.equal(profile.documentCheck.previousLandlord.arrears, null);
  assert.equal(profile.documentCheck.complete, false);
  assert.deepEqual(issueCodes({ profile }), ["previous_landlord_missing"]);
  assert.equal(profile.credibilityScore, 85);
});

test("a previous-landlord confirmation stating rent arrears is flagged", async () => {
  const { profile } = (await readFixtures()).byId("A-arrears");

  assert.equal(profile.documentCheck.previousLandlord.status, "present");
  assert.equal(profile.documentCheck.previousLandlord.arrears, true);
  assert.match(profile.documentCheck.previousLandlord.reason, /arrears/);
  assert.equal(profile.documentCheck.complete, true, "the document is there and valid");
  assert.deepEqual(issueCodes({ profile }), ["rent_arrears"]);
  assert.equal(profile.credibilityScore, 85);
});

test("a payslip in another person's name makes the income proof inconsistent", async () => {
  const { profile } = (await readFixtures()).byId("A-other-name");

  assert.equal(profile.documentCheck.incomeProof.status, "inconsistent");
  assert.match(profile.documentCheck.incomeProof.reason, /Jonas Schmidt/);
  assert.equal(profile.documentCheck.complete, false);
  assert.deepEqual(issueCodes({ profile }), ["name_mismatch"]);
  assert.equal(profile.credibilityScore, 70);
});

test("a SCHUFA-Auskunft in another person's name does not count as the applicant's", async () => {
  const { profile } = (await readFixtures()).byId("A-other-name-schufa");

  assert.equal(profile.documentCheck.schufa.status, "inconsistent");
  assert.equal(profile.schufaStatus, "missing");
  assert.deepEqual(issueCodes({ profile }), ["name_mismatch"]);
});

test("files that cannot be read as an application become errors, and the other files are still read", async () => {
  const { applicants, errors, byId } = await readFixtures();

  assert.deepEqual(
    errors.map((error) => error.file),
    ["duplicate-id.md", "impossible-date.md", "malformed.md", "no-front-matter.md", "no-household.md", "two-schufas.md"],
  );
  for (const error of errors) assert.equal(typeof error.reason, "string", error.file);
  assert.match(errors[0].reason, /A-complete/);
  assert.match(errors[1].reason, /moveInDate/, "there is no 30 February");
  assert.match(errors[2].reason, /netHouseholdIncome 3800/);
  assert.match(errors[4].reason, /household/);
  assert.match(errors[5].reason, /SCHUFA-Auskunft/, "a document heading appears twice");
  assert.ok(byId("A-complete"));
  assert.equal(applicants.length, 17, "every other .md fixture is read; other files are ignored");
});

test("protected and unknown front matter fields never reach the Applicant profile or the contact", async () => {
  const applicant = (await readFixtures()).byId("A-protected");

  assert.deepEqual(Object.keys(applicant).sort(), ["contact", "id", "profile"]);
  assert.deepEqual(applicant.contact, { name: "Lena Schmidt", email: "lena.schmidt@example.org", phone: "+49 30 1234567" });
  assert.deepEqual(Object.keys(applicant.profile).sort(), [
    "credibilityScore",
    "documentCheck",
    "employmentType",
    "household",
    "householdSize",
    "id",
    "moveInDate",
    "netHouseholdIncome",
    "pets",
    "schufaStatus",
    "smoking",
  ]);
  assert.deepEqual(applicant.profile.household, { adults: 2, children: 1, childrenUpToSix: 1 });
  const everything = JSON.stringify(applicant);
  for (const value of ["Italian", "Catholic", "1988-04-12", "female", "a-protected.jpg", "second child", "disability", "@lena", "Kastanienallee", "childAges", "Siemens"]) {
    assert.ok(!everything.includes(value), `${value} leaked`);
  }
});

test("the pool summary counts the applicants per defect type and lists the unreadable files", async () => {
  const summary = summarizeApplicantPool(await readApplicantPool(FIXTURES, { today: TODAY }));
  summary.errors = summary.errors.map((error) => error.file);

  assert.deepEqual(summary, {
    total: 17,
    clean: 4,
    defects: {
      first_time_renter: 1,
      income_mismatch: 1,
      income_proof_missing: 1,
      large_household: 1,
      name_mismatch: 2,
      previous_landlord_missing: 1,
      rent_arrears: 1,
      schufa_expired: 1,
      schufa_missing: 1,
      schufa_negative: 1,
      schufa_unreadable: 2, // A-unreadable-schufa, and A-feb-schufa (dated after today)
    },
    errors: ["duplicate-id.md", "impossible-date.md", "malformed.md", "no-front-matter.md", "no-household.md", "two-schufas.md"],
  });
});
