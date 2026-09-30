import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { readApplicantPool } from "../../src/landlord/applicant-pool.js";
import { getApplicantProfile } from "../../src/landlord/applicant-profile.js";
import { rankApplicants } from "../../src/landlord/scorer.js";

const directory = fileURLToPath(new URL("../fixtures/applicants/", import.meta.url));
const listing = { livingAreaSqm: 50, rooms: 2, askingRent: 700 };

test("the reusable lookup returns a scored profile without contact, using the existing scorer", async () => {
  const { applicants } = await readApplicantPool(directory, { today: "2026-09-29" });
  const result = getApplicantProfile({ applicants, listing, applicantId: "A-protected" });
  const expected = rankApplicants({ profiles: applicants.map(({ profile }) => profile), listing }).ranked.find(({ applicantId }) => applicantId === "A-protected");

  assert.deepEqual(Object.keys(result), ["profile", "score", "rentToIncome"]);
  assert.deepEqual(result.score, expected);
  assert.equal(result.rentToIncome, expected.rentToIncome);
  assert.equal(result.profile.id, "A-protected");
  assert.ok(!JSON.stringify(result).includes("lena.schmidt@example.org"));
  assert.equal(getApplicantProfile({ applicants, listing, applicantId: "absent" }), null);
  assert.equal(getApplicantProfile({ applicants, listing: null, applicantId: "A-protected" }).score, null);
  const mismatch = getApplicantProfile({ applicants, listing, applicantId: "A-other-name" });
  assert.ok(!JSON.stringify(mismatch).includes("Jonas Schmidt"));
  assert.ok(!JSON.stringify(mismatch).includes("Lena Schmidt"));
  assert.ok(!mismatch.profile.documentCheck.issues.some(({ code }) => code === "name_mismatch"), "name clarification stays outside model-facing data");
});
