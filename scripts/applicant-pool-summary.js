// Prints the Applicant pool summary: `npm run pool:summary [-- <directory>] [--today YYYY-MM-DD]`.
// The pool is data/applicants by default, read as of the day it was generated (POOL_DATE).
import { parseArgs } from "node:util";

import { POOL_DATE } from "../src/landlord/applicant-pool-generator.js";
import { APPLICANT_POOL_DIRECTORY, readApplicantPool, summarizeApplicantPool } from "../src/landlord/applicant-pool.js";

const { values, positionals } = parseArgs({ options: { today: { type: "string" } }, allowPositionals: true });
const directory = positionals[0] ?? APPLICANT_POOL_DIRECTORY;
const today = values.today ?? POOL_DATE;

const pool = await readApplicantPool(directory, { today });
const summary = summarizeApplicantPool(pool);
const lines = [
  `Applicant pool: ${directory} (as of ${today})`,
  `Applicants: ${summary.total}`,
  `Complete and clean: ${summary.clean}`,
  "Per defect type:",
  ...Object.entries(summary.defects).map(([defect, count]) => `  ${defect}: ${count}`),
  `Unreadable files: ${pool.errors.length === 0 ? "none" : pool.errors.length}`,
  ...pool.errors.map((error) => `  ${error.file}: ${error.reason}`),
];
console.log(lines.join("\n"));
