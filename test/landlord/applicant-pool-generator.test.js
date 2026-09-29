import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DEFAULT_POOL_SEED, generateApplicantPool, POOL_DATE } from "../../src/landlord/applicant-pool-generator.js";
import { readApplicantPool, summarizeApplicantPool } from "../../src/landlord/applicant-pool.js";

test("the same seed generates byte-identical applicant files; another seed generates others", () => {
  const first = generateApplicantPool({ seed: 42 });
  const again = generateApplicantPool({ seed: 42 });
  const other = generateApplicantPool({ seed: 7 });

  assert.deepEqual(again, first);
  assert.notDeepEqual(other, first);
  assert.ok(first.length >= 35 && first.length <= 45, `about 40 applicants, got ${first.length}`);
  for (const { file, content } of first) {
    assert.match(file, /^[\w-]+\.md$/);
    assert.equal(typeof content, "string");
  }
});

test("every generated file reads as an application", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "applicant-pool-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = generateApplicantPool({ seed: 7 });
  for (const { file, content } of files) await writeFile(join(directory, file), content);

  const { applicants, errors } = await readApplicantPool(directory, { today: POOL_DATE });

  assert.deepEqual(errors, []);
  assert.equal(applicants.length, files.length);
});

const COMMITTED_POOL = fileURLToPath(new URL("../../data/applicants/", import.meta.url));

test("the committed pool is exactly the generator's output for the default seed", async () => {
  const generated = generateApplicantPool({ seed: DEFAULT_POOL_SEED });
  const committed = (await readdir(COMMITTED_POOL)).filter((file) => file.endsWith(".md")).sort();

  assert.deepEqual(committed, generated.map(({ file }) => file).sort());
  for (const { file, content } of generated) {
    assert.equal(await readFile(join(COMMITTED_POOL, file), "utf8"), content, `${file} differs; run npm run pool:generate`);
  }
});

test("the committed pool reads without errors and contains every deliberate defect type", async () => {
  const pool = await readApplicantPool(COMMITTED_POOL, { today: POOL_DATE });
  const summary = summarizeApplicantPool(pool);

  assert.deepEqual(pool.errors, []);
  assert.ok(summary.total >= 35 && summary.total <= 45, `about 40 applicants, got ${summary.total}`);
  assert.ok(summary.clean > 0, "some applications are complete and clean");
  for (const defect of [
    "schufa_missing",
    "schufa_expired",
    "income_mismatch",
    "name_mismatch",
    "schufa_negative",
    "first_time_renter",
    "rent_arrears",
    "large_household",
  ]) {
    assert.ok(summary.defects[defect] > 0, `no applicant with ${defect}`);
  }
  const protectedFields = ["nationality", "religion", "dateOfBirth", "gender", "photo", "familyPlans"];
  const raw = await readFile(join(COMMITTED_POOL, "A-001.md"), "utf8");
  for (const field of protectedFields) assert.match(raw, new RegExp(`^${field}: `, "m"), `the pool declares ${field}`);
});

test("the pool summary command prints the applicants, the defect counts and the unreadable files", () => {
  const output = execFileSync(process.execPath, [fileURLToPath(new URL("../../scripts/applicant-pool-summary.js", import.meta.url))], {
    encoding: "utf8",
  });

  assert.match(output, /Applicants: \d+/);
  assert.match(output, /schufa_expired: \d+/);
  assert.match(output, /large_household: \d+/);
  assert.match(output, /Unreadable files: none/);
});
