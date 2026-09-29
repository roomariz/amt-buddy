// Writes the synthetic Applicant pool to data/applicants (or the directory given as the first
// argument), replacing the .md files there: `npm run pool:generate [-- <directory>] [--seed <n>]`.
// The committed pool is this script's output for the default seed.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { DEFAULT_POOL_SEED, generateApplicantPool } from "../src/landlord/applicant-pool-generator.js";
import { APPLICANT_POOL_DIRECTORY } from "../src/landlord/applicant-pool.js";

const { values, positionals } = parseArgs({ options: { seed: { type: "string" } }, allowPositionals: true });
const seed = values.seed === undefined ? DEFAULT_POOL_SEED : Number(values.seed);
if (!Number.isInteger(seed)) throw new Error(`--seed must be a whole number, got ${values.seed}.`);
const directory = positionals[0] ?? APPLICANT_POOL_DIRECTORY;

await mkdir(directory, { recursive: true });
for (const file of await readdir(directory)) {
  if (file.endsWith(".md")) await rm(join(directory, file));
}
const files = generateApplicantPool({ seed });
for (const { file, content } of files) await writeFile(join(directory, file), content);
console.log(`Wrote ${files.length} applicant files (seed ${seed}) to ${directory}`);
