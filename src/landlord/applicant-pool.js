import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The committed synthetic Applicant pool (see scripts/generate-applicant-pool.js).
export const APPLICANT_POOL_DIRECTORY = fileURLToPath(new URL("../../data/applicants/", import.meta.url));

// An applicant file that cannot be read as an application.
export class ApplicantFileError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApplicantFileError";
  }
}

// --- Front matter: the small YAML subset the pool uses -------------------------------------
// `key: value` lines, maps nested by two-space indentation, and scalars: numbers, true/false,
// null, "double-quoted" strings and plain strings. Anything else is an ApplicantFileError.

// One front matter value: number, true/false, null, "quoted" or plain string.
function parseScalar(raw) {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new ApplicantFileError(`Front matter has a badly quoted value: ${value}`);
    }
  }
  return value;
}

function parseFrontMatter(text) {
  const root = {};
  const stack = [{ indent: -1, map: root }];
  for (const [index, line] of text.split("\n").entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^( *)([A-Za-z][\w-]*):(?: (.*))?$/.exec(line);
    if (!match) throw new ApplicantFileError(`Front matter line ${index + 1} is not 'key: value': ${line.trim()}`);
    const [, spaces, key, rawValue = ""] = match;
    const indent = spaces.length;
    while (indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1);
    if (indent % 2 !== 0 || (parent.childIndent !== undefined && indent !== parent.childIndent)) {
      throw new ApplicantFileError(`Front matter line ${index + 1} is badly indented.`);
    }
    parent.childIndent = indent;
    if (Object.hasOwn(parent.map, key)) throw new ApplicantFileError(`Front matter repeats the key '${key}'.`);
    if (rawValue.trim() === "") {
      parent.map[key] = {};
      stack.push({ indent, map: parent.map[key] });
    } else {
      parent.map[key] = parseScalar(rawValue);
    }
  }
  return root;
}

// Splits a file into its front matter and its `## Heading` sections (heading → text).
function splitApplicantFile(text) {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, "\n"));
  if (!match) throw new ApplicantFileError("The file has no front matter between '---' lines.");
  const [, frontMatter, body] = match;
  const sections = {};
  let current = null;
  for (const line of body.split("\n")) {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) {
      current = heading[1];
      if (Object.hasOwn(sections, current)) throw new ApplicantFileError(`The section '${current}' appears twice.`);
      sections[current] = [];
    } else if (current) {
      sections[current].push(line);
    }
  }
  return {
    declared: parseFrontMatter(frontMatter),
    sections: Object.fromEntries(Object.entries(sections).map(([heading, lines]) => [heading, lines.join("\n").trim()])),
  };
}

// --- The Application documents ---------------------------------------------------------------

// The fixed section headings of the three Application documents.
export const DOCUMENT_HEADINGS = {
  schufa: "SCHUFA-Auskunft",
  incomeProof: "Income proof",
  previousLandlord: "Previous-landlord confirmation",
};

// The values of every `Label: value` line with this label in a document's text.
const fieldValues = (text, label) =>
  [...text.matchAll(new RegExp(`^${label}:[ \\t]*(.*)$`, "gm"))].map((match) => match[1].trim());

const PRESENT = { status: "present", reason: null };

// What each Document check issue costs the Credibility score (out of 100).
const CREDIBILITY_PENALTIES = {
  schufa_missing: 25,
  schufa_expired: 15,
  schufa_unreadable: 25,
  income_proof_missing: 30,
  income_mismatch: 30,
  previous_landlord_missing: 15,
  previous_landlord_unreadable: 15,
  name_mismatch: 30,
  rent_arrears: 15,
};

// How far the income proof's average net pay may be from the declared net household income.
const INCOME_TOLERANCE = 0.1;

// How old a SCHUFA-Auskunft may be, in months before today.
const SCHUFA_MAX_AGE_MONTHS = 3;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
// A real calendar day written "YYYY-MM-DD" (not 30 February).
const isIsoDay = (value) =>
  typeof value === "string" && ISO_DAY.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

// The day `months` calendar months before `day` ("YYYY-MM-DD"); past a shorter month's end it
// is that month's last day (3 months before 31 May is 28 February).
function monthsBefore(day, months) {
  const [year, month, date] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDate = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, lastDate));
  return target.toISOString().slice(0, 10);
}

const issue = (document, code, message) => ({ document, code, message });

// A document check result without a problem, or with one: its status, reason and the issue.
const passed = (extra = {}) => ({ result: { ...PRESENT, ...extra }, issues: [] });
const failed = (document, status, code, reason, extra = {}) => ({
  result: { status, reason, ...extra },
  issues: [issue(document, code, reason)],
});

const nameKey = (name) => String(name).trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");

// Why the document is not the applicant's (a `Name:` line with another name, or none), or null.
function nameProblem(text, documentName, applicantName) {
  const names = fieldValues(text, "Name");
  if (names.length === 0) return `The ${documentName} names nobody.`;
  const other = names.find((name) => nameKey(name) !== nameKey(applicantName));
  return other ? `The ${documentName} is in the name of ${other}, not ${applicantName}.` : null;
}

// The first word of a document value, lower-case ("Negativ – 2 Forderungen" → "negativ").
const firstWord = (value) => value.split(/[\s–-]/)[0].toLowerCase();

// The SCHUFA status from the report's `Einträge:` line ("keine", "geringfügig – …", "negativ – …"),
// or null when it says something else.
function schufaStatusOf(entries = "") {
  return { keine: "clean", "geringfügig": "minor_entries", negativ: "negative" }[firstWord(entries)] ?? null;
}

// → { schufaStatus, result, issues }. The status of a report that is missing, unreadable or in
// another person's name is "missing"; an expired report's status is still read.
function checkSchufa(text, applicantName, today) {
  const withStatus = (schufaStatus, check) => ({ schufaStatus, ...check });
  if (!text) return withStatus("missing", failed("schufa", "missing", "schufa_missing", "No SCHUFA-Auskunft."));
  const [issuedOn] = fieldValues(text, "Ausstellungsdatum");
  const schufaStatus = schufaStatusOf(fieldValues(text, "Einträge")[0]);
  if (!isIsoDay(issuedOn) || !schufaStatus) {
    const reason = "The SCHUFA-Auskunft has no readable issue date (Ausstellungsdatum) or entries (Einträge).";
    return withStatus("missing", failed("schufa", "inconsistent", "schufa_unreadable", reason));
  }
  if (issuedOn > today) {
    const reason = `The SCHUFA-Auskunft is dated ${issuedOn}, after today.`;
    return withStatus("missing", failed("schufa", "inconsistent", "schufa_unreadable", reason));
  }
  const wrongName = nameProblem(text, "SCHUFA-Auskunft", applicantName);
  if (wrongName) return withStatus("missing", failed("schufa", "inconsistent", "name_mismatch", wrongName));
  if (issuedOn < monthsBefore(today, SCHUFA_MAX_AGE_MONTHS)) {
    const reason = `The SCHUFA-Auskunft was issued on ${issuedOn}, more than ${SCHUFA_MAX_AGE_MONTHS} months ago.`;
    return withStatus(schufaStatus, failed("schufa", "expired", "schufa_expired", reason));
  }
  return withStatus(schufaStatus, passed());
}

// A German amount ("3.790,00 EUR") as a number, or NaN.
const parseEuro = (text) => Number(text.replace(/\s*(EUR|€)\s*$/, "").replaceAll(".", "").replace(",", "."));

// The income proof's average net pay (`Netto:` lines) must be within 10 % of the declared income.
function checkIncomeProof(text, applicantName, declaredIncome) {
  if (!text) return failed("incomeProof", "missing", "income_proof_missing", "No income proof.");
  const wrongName = nameProblem(text, "income proof", applicantName);
  if (wrongName) return failed("incomeProof", "inconsistent", "name_mismatch", wrongName);
  const amounts = fieldValues(text, "Netto").map(parseEuro);
  if (amounts.length === 0 || amounts.some((amount) => !Number.isFinite(amount))) {
    return failed("incomeProof", "inconsistent", "income_mismatch", "The income proof states no readable net pay (Netto).");
  }
  const average = Math.round(amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length);
  if (Math.abs(average - declaredIncome) > declaredIncome * INCOME_TOLERANCE) {
    const reason = `The income proof shows ${average} € net on average, more than ${INCOME_TOLERANCE * 100} % off the declared ${declaredIncome} €.`;
    return failed("incomeProof", "inconsistent", "income_mismatch", reason);
  }
  return passed();
}

// A first-time renter needs no confirmation (status "not_required"). The confirmation's
// `Mietrückstände:` line says whether rent arrears are open ("nein" / "ja – …"): with arrears the
// document is present and valid (`arrears: true`), but the Document check has a `rent_arrears` issue.
// `arrears` is null whenever there is no usable confirmation.
function checkPreviousLandlord(text, applicantName, firstTimeRenter) {
  const noArrears = { arrears: null };
  if (!text && firstTimeRenter) {
    return { result: { status: "not_required", reason: "First-time renter: there is no previous landlord.", ...noArrears }, issues: [] };
  }
  if (!text) {
    const reason = "No previous-landlord confirmation, although the applicant rented before.";
    return failed("previousLandlord", "missing", "previous_landlord_missing", reason, noArrears);
  }
  const wrongName = nameProblem(text, "previous-landlord confirmation", applicantName);
  if (wrongName) return failed("previousLandlord", "inconsistent", "name_mismatch", wrongName, noArrears);
  const answer = firstWord(fieldValues(text, "Mietrückstände")[0] ?? "");
  if (answer === "nein") return passed({ arrears: false });
  if (answer === "ja") {
    const reason = "The previous landlord confirms rent arrears.";
    return { result: { status: "present", reason, arrears: true }, issues: [issue("previousLandlord", "rent_arrears", reason)] };
  }
  const reason = "The previous-landlord confirmation does not say whether rent arrears are open (Mietrückstände).";
  return failed("previousLandlord", "inconsistent", "previous_landlord_unreadable", reason, noArrears);
}

// Document statuses that count towards a complete application.
const COMPLETE_STATUSES = new Set(["present", "not_required"]);

// The Document check of one application → { schufaStatus, documentCheck }.
function documentCheckOf(declared, sections, today) {
  const { name } = declared;
  const schufa = checkSchufa(sections[DOCUMENT_HEADINGS.schufa], name, today);
  const incomeProof = checkIncomeProof(sections[DOCUMENT_HEADINGS.incomeProof], name, declared.netHouseholdIncome);
  const previousLandlord = checkPreviousLandlord(sections[DOCUMENT_HEADINGS.previousLandlord], name, declared.firstTimeRenter);
  const issues = [...schufa.issues, ...incomeProof.issues, ...previousLandlord.issues];
  return {
    schufaStatus: schufa.schufaStatus,
    documentCheck: {
      schufa: schufa.result,
      incomeProof: incomeProof.result,
      previousLandlord: previousLandlord.result,
      complete: [schufa, incomeProof, previousLandlord].every(({ result }) => COMPLETE_STATUSES.has(result.status)),
      issues,
    },
  };
}

// The Credibility score: 100 minus the penalty of every issue of the Document check, at least 0.
const credibilityScoreOf = (issues) =>
  Math.max(0, issues.reduce((score, { code }) => score - CREDIBILITY_PENALTIES[code], 100));

// --- The declared data -------------------------------------------------------------------------

// The employment types an application can declare.
export const EMPLOYMENT_TYPES = ["permanent", "civil_servant", "fixed_term", "self_employed", "student_with_guarantor", "other"];

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim() !== "";
const isCount = (value, min = 0) => Number.isInteger(value) && value >= min;

// The front matter fields every application must declare, each with what it must be.
const DECLARED_FIELDS = [
  ["id", (d) => isText(d.id) || typeof d.id === "number", "a text"],
  ["name", (d) => isText(d.name), "a text"],
  ["contact", (d) => isPlainObject(d.contact) && isText(d.contact.email) && isText(d.contact.phone), "a map with 'email' and 'phone'"],
  [
    "household",
    (d) =>
      isPlainObject(d.household) &&
      isCount(d.household.adults, 1) &&
      isCount(d.household.children) &&
      isCount(d.household.childrenUpToSix) &&
      d.household.childrenUpToSix <= d.household.children,
    "a map with 'adults' (at least 1), 'children' and 'childrenUpToSix' (at most 'children')",
  ],
  ["netHouseholdIncome", (d) => typeof d.netHouseholdIncome === "number" && d.netHouseholdIncome > 0, "a number of EUR above 0"],
  ["employment", (d) => isPlainObject(d.employment) && EMPLOYMENT_TYPES.includes(d.employment.type), `a map with 'type' one of ${EMPLOYMENT_TYPES.join(", ")}`],
  ["moveInDate", (d) => isIsoDay(d.moveInDate), "a day YYYY-MM-DD"],
  ["pets", (d) => typeof d.pets === "boolean", "true or false"],
  ["smoking", (d) => typeof d.smoking === "boolean", "true or false"],
  ["firstTimeRenter", (d) => typeof d.firstTimeRenter === "boolean", "true or false"],
];

// Throws an ApplicantFileError naming every declared field that is missing or wrong.
function assertDeclaredData(declared) {
  const wrong = DECLARED_FIELDS.filter(([, isValid]) => !isValid(declared)).map(([field, , expected]) => `'${field}' must be ${expected}`);
  if (wrong.length > 0) throw new ApplicantFileError(`Front matter: ${wrong.join("; ")}.`);
}

// --- The Applicant --------------------------------------------------------------------------

// One application → { id, contact, profile }.
function toApplicant(declared, sections, today) {
  assertDeclaredData(declared);
  const { schufaStatus, documentCheck } = documentCheckOf(declared, sections, today);
  const { adults, children, childrenUpToSix } = declared.household;
  // The Applicant profile is built field by field (a whitelist): no protected or unknown field
  // of the front matter can reach it.
  const profile = {
    id: String(declared.id),
    householdSize: adults + children,
    household: { adults, children, childrenUpToSix },
    netHouseholdIncome: declared.netHouseholdIncome,
    employmentType: declared.employment.type,
    schufaStatus,
    moveInDate: declared.moveInDate,
    pets: declared.pets,
    smoking: declared.smoking,
    documentCheck,
    credibilityScore: credibilityScoreOf(documentCheck.issues),
  };
  const { email, phone } = declared.contact;
  return { id: profile.id, contact: { name: declared.name, email, phone }, profile };
}

// readApplicantPool(directory, { today }) → { applicants, errors }
// Reads every `.md` file of the Applicant pool directory, in file-name order.
// - applicants: [{ id, contact: { name, email, phone }, profile }]: the Applicant profile is the
//   anonymised view everything downstream uses; name and contact are beside it for display only.
//   profile: { id, householdSize, household: { adults, children, childrenUpToSix },
//     netHouseholdIncome, employmentType (EMPLOYMENT_TYPES), schufaStatus ("clean" |
//     "minor_entries" | "negative" | "missing": also for a report that is unreadable, dated after
//     today or in another person's name), moveInDate, pets, smoking, credibilityScore (0–100),
//     documentCheck: { schufa, incomeProof, previousLandlord, complete, issues } }.
//   Each document is { status: "present" | "missing" | "expired" | "inconsistent" | "not_required",
//   reason }; previousLandlord also has `arrears` (true / false / null: no usable confirmation).
//   `complete`: every document is present (or not required). issues: [{ document, code, message }].
// - errors: [{ file, reason }]: files that could not be read as an application; the other
//   files are still read.
// `today` (required; "YYYY-MM-DD", or a Date taken as its UTC day) is the day the SCHUFA-Auskunft's
// age is measured against. The committed pool is dated relative to POOL_DATE
// (applicant-pool-generator.js): read it with that day to see the pool as generated.
export async function readApplicantPool(directory, { today } = {}) {
  const day = today instanceof Date && !Number.isNaN(today.getTime()) ? today.toISOString().slice(0, 10) : today;
  if (!isIsoDay(day)) throw new TypeError(`'today' must be a Date or a "YYYY-MM-DD" day, got ${today}.`);
  const files = (await readdir(directory)).filter((file) => file.endsWith(".md")).sort();
  const applicants = [];
  const errors = [];
  for (const file of files) {
    try {
      const { declared, sections } = splitApplicantFile(await readFile(join(directory, file), "utf8"));
      const applicant = toApplicant(declared, sections, day);
      if (applicants.some(({ id }) => id === applicant.id)) {
        throw new ApplicantFileError(`Another file already has the applicant id '${applicant.id}'.`);
      }
      applicants.push(applicant);
    } catch (error) {
      if (!(error instanceof ApplicantFileError)) throw error;
      errors.push({ file, reason: error.message });
    }
  }
  return { applicants, errors };
}

// A household of at least this many people is too large for a typical flat.
export const LARGE_HOUSEHOLD_SIZE = 5;

// The defect types of one Applicant: the Document check's issue codes plus the traits the pool
// deliberately mixes in that are not document problems (negative SCHUFA, first-time renter, a
// household of LARGE_HOUSEHOLD_SIZE or more).
function defectsOf({ profile }) {
  const { documentCheck } = profile;
  const defects = new Set(documentCheck.issues.map((issue) => issue.code));
  if (profile.schufaStatus === "negative") defects.add("schufa_negative");
  if (documentCheck.previousLandlord.status === "not_required") defects.add("first_time_renter");
  if (profile.householdSize >= LARGE_HOUSEHOLD_SIZE) defects.add("large_household");
  return defects;
}

// summarizeApplicantPool({ applicants, errors }) → { total, clean, defects, errors }: the number
// of applicants, how many have no defect, how many have each defect type (sorted by type), and
// the files that could not be read ([{ file, reason }]).
export function summarizeApplicantPool({ applicants, errors }) {
  const defects = {};
  let clean = 0;
  for (const applicant of applicants) {
    const found = defectsOf(applicant);
    if (found.size === 0) clean += 1;
    for (const defect of found) defects[defect] = (defects[defect] ?? 0) + 1;
  }
  const sorted = Object.fromEntries(Object.entries(defects).sort(([a], [b]) => a.localeCompare(b)));
  return { total: applicants.length, clean, defects: sorted, errors };
}
