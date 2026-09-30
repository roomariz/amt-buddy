import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DEFAULT_POOL_SEED, generateApplicantPool, POOL_DATE } from "../../src/landlord/applicant-pool-generator.js";
import { readApplicantPool, summarizeApplicantPool } from "../../src/landlord/applicant-pool.js";

async function readMatchingNames() {
  const csv = await readFile(fileURLToPath(new URL("../../data/name_matching_50.csv", import.meta.url)), "utf8");
  return csv.trim().split(/\r?\n/).slice(1).map((line) => line.match(/"((?:[^"]|"")*)"/g).map((value) => value.slice(1, -1).replaceAll('""', '"')));
}

function fieldsById(files) {
  return new Map(files.map(({ file, content }) => [content.match(/^id: (.+)$/m)[1], { file, content }]));
}

test("the same seed generates byte-identical applicant files; another seed generates others", () => {
  const first = generateApplicantPool({ seed: 42 });
  const again = generateApplicantPool({ seed: 42 });
  const other = generateApplicantPool({ seed: 7 });

  assert.deepEqual(again, first);
  assert.notDeepEqual(other, first);
  assert.equal(first.length, 95, `50 CSV applicants, 5 spelling duplicates, and the original 40; got ${first.length}`);
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
  assert.equal(summary.total, 95);
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

test("name mismatch reasons stay generic and all personal names stay outside Applicant profiles", async () => {
  const { applicants } = await readApplicantPool(COMMITTED_POOL, { today: POOL_DATE });
  const byId = new Map(applicants.map((applicant) => [applicant.id, applicant]));

  for (const [id, personalNames] of [
    ["A-002", ["Olga Rossi", "Diego Rossi"]],
    ["A-011", ["Aylin Rossi", "Wei Rossi", "Lina Rossi", "Paul Rossi"]],
  ]) {
    const profile = byId.get(id).profile;
    const nameIssues = profile.documentCheck.issues.filter(({ code }) => code === "name_mismatch");
    assert.ok(nameIssues.length > 0, `${id} should contain a name discrepancy`);
    assert.ok(nameIssues.every(({ message }) => /needs clarification/.test(message)));
    const serialized = JSON.stringify(profile);
    for (const name of personalNames) assert.ok(!serialized.includes(name), `${id}'s ${name} reached the profile`);
  }
  for (const { id, contact, profile } of applicants) {
    const serialized = JSON.stringify(profile);
    for (const value of [contact.name, contact.email, contact.phone]) {
      assert.ok(!serialized.includes(value), `${id}'s contact detail reached its profile`);
    }
  }
});

test("the CSV profiles include all names, spelling-only duplicates, and cross-document mismatches", async (t) => {
  const rows = await readMatchingNames();
  const files = generateApplicantPool({ seed: DEFAULT_POOL_SEED });
  const byId = fieldsById(files);
  assert.equal(rows.length, 50);
  for (let index = 0; index < rows.length; index += 1) {
    const applicant = byId.get(`A-${String(index + 41).padStart(3, "0")}`);
    assert.ok(applicant, `missing CSV applicant row ${index + 1}`);
    assert.ok(applicant.content.includes(`name: ${rows[index][0]}\n`), `CSV name not used: ${rows[index][0]}`);
  }

  const duplicateRows = [0, 20, 30, 40, 49];
  const normalizeNameAndId = (content) => content
    .replace(/^id: .+$/m, "id: <id>")
    .replace(/^name: .+$/m, "name: <name>")
    .replace(/^Name: .+$/gm, "Name: <name>");
  duplicateRows.forEach((row, duplicateIndex) => {
    const original = byId.get(`A-${String(row + 41).padStart(3, "0")}`).content;
    const duplicate = byId.get(`A-${String(duplicateIndex + 91).padStart(3, "0")}`).content;
    assert.notEqual(original.match(/^name: (.+)$/m)[1], duplicate.match(/^name: (.+)$/m)[1]);
    assert.equal(normalizeNameAndId(original), normalizeNameAndId(duplicate), "duplicate should differ only by name spelling and required unique ID");
  });

  const directory = await mkdtemp(join(tmpdir(), "name-variants-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const { file, content } of files) await writeFile(join(directory, file), content);
  const pool = await readApplicantPool(directory, { today: POOL_DATE });
  assert.deepEqual(pool.errors, []);
  const nameMismatches = pool.applicants.filter(({ profile }) => profile.documentCheck.issues.some(({ code }) => code === "name_mismatch"));
  assert.equal(nameMismatches.length, 18, "15 CSV document differences plus 3 existing other-person names");
  assert.ok(nameMismatches.every(({ profile }) => profile.credibilityScore === 100), "name differences stay neutral to credibility");
  const byApplicantId = new Map(pool.applicants.map((applicant) => [applicant.id, applicant]));
  for (let row = 0; row < 15; row += 1) {
    const applicant = byApplicantId.get(`A-${String(row + 46).padStart(3, "0")}`);
    assert.equal(applicant.profile.documentCheck.issues.filter(({ code }) => code === "name_mismatch").length, 1);
    assert.equal(applicant.profile.documentCheck.complete, true, "one name spelling difference does not make the other documents incomplete");
  }
  for (const id of ["A-091", "A-092", "A-093", "A-094", "A-095"]) {
    const duplicate = byApplicantId.get(id);
    assert.equal(duplicate.profile.documentCheck.issues.some(({ code }) => code === "name_mismatch"), false);
    assert.equal(duplicate.profile.documentCheck.complete, true);
  }
});

test("some existing accented-name documents use the same letters without accent marks", () => {
  const files = generateApplicantPool({ seed: DEFAULT_POOL_SEED }).filter(({ file }) => Number(file.slice(2, 5)) <= 40);
  const changed = files.filter(({ content }) => {
    const name = content.match(/^name: (.+)$/m)?.[1];
    if (!name || !/\p{M}/u.test(name.normalize("NFD"))) return false;
    const documentNames = [...content.matchAll(/^Name: (.+)$/gm)].map((match) => match[1]);
    return documentNames.some((documentName) => documentName === name.normalize("NFD").replace(/\p{M}/gu, ""));
  });
  assert.ok(changed.length >= 3, `expected several accent-simplified existing profiles, got ${changed.length}`);
});

test("accent-only name variants appear in at least 25 profiles without creating a mismatch", async (t) => {
  const rows = await readMatchingNames();
  const files = generateApplicantPool({ seed: DEFAULT_POOL_SEED });
  const byId = fieldsById(files);
  const variedProfiles = rows.filter(([, variant], index) => {
    const content = byId.get(`A-${String(index + 41).padStart(3, "0")}`).content;
    return [...content.matchAll(/^Name: (.+)$/gm)].some((match) => match[1] === variant);
  });
  assert.ok(variedProfiles.length >= 25, `expected at least 25 profiles with basic-letter document spelling, got ${variedProfiles.length}`);

  const elodie = byId.get("A-077").content;
  assert.match(elodie, /^name: Élodie Lefèvre$/m);
  const elodieIncomeProof = elodie.match(/## Income proof\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
  assert.deepEqual([...elodieIncomeProof.matchAll(/^Name: (.+)$/gm)].map((match) => match[1]), Array(3).fill("Elodie Lefevre"));

  const jose = byId.get("A-066").content;
  assert.match(jose, /^name: José Cruz Mendoza$/m);
  assert.match(jose, /Mietschuldenfreiheitsbescheinigung\nName: Jose Cruz Mendoza/);

  for (const { file, content } of files) {
    const incomeProof = content.match(/## Income proof\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
    const incomeNames = [...incomeProof.matchAll(/^Name: (.+)$/gm)].map((match) => match[1]);
    assert.ok(incomeNames.every((name) => name === incomeNames[0]), `${file} has inconsistent names across its income proofs`);
  }

  const directory = await mkdtemp(join(tmpdir(), "accepted-accent-variants-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const { file, content } of files) await writeFile(join(directory, file), content);
  const pool = await readApplicantPool(directory, { today: POOL_DATE });
  const profiles = new Map(pool.applicants.map((applicant) => [applicant.id, applicant.profile]));
  for (let index = 0; index < rows.length; index += 1) {
    const id = `A-${String(index + 41).padStart(3, "0")}`;
    const content = byId.get(id).content;
    if (![...content.matchAll(/^Name: (.+)$/gm)].some((match) => match[1] === rows[index][1])) continue;
    assert.equal(profiles.get(id).documentCheck.issues.some(({ code }) => code === "name_mismatch"), false, `${id} should accept accent-only name variation`);
    assert.equal(profiles.get(id).credibilityScore, 100, `${id} should keep a full Credibility score`);
  }
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
