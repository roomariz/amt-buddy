// The synthetic Applicant pool: applications that have "already arrived" for the Landlord's
// flat. generateApplicantPool({ seed }) is deterministic, so the committed files in
// data/applicants are exactly its output for DEFAULT_POOL_SEED (see
// scripts/generate-applicant-pool.js). All people, employers and documents are made up.

import { DOCUMENT_HEADINGS } from "./applicant-pool.js";

export const DEFAULT_POOL_SEED = 20260929;

// The day the pool was generated: its documents are dated relative to it, so its SCHUFA-Auskünfte
// are current (or deliberately expired) when the pool is read with this `today`.
export const POOL_DATE = "2026-09-28";

// The mix of applications: how many of each scenario. Every deliberate defect type is there.
const SCENARIO_COUNTS = {
  clean: 14,
  missing_schufa: 3,
  expired_schufa: 3,
  low_income: 3,
  other_name: 3,
  negative_schufa: 3,
  first_time_renter: 4,
  arrears: 3,
  large_household: 4,
};

// mulberry32: a small seeded pseudo-random generator, returning numbers in [0, 1).
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomTools(random) {
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));
  const pick = (items) => items[Math.floor(random() * items.length)];
  const chance = (probability) => random() < probability;
  const shuffle = (items) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };
  return { int, pick, chance, shuffle };
}

const FIRST_NAMES = [
  "Lena", "Jonas", "Mia", "Lukas", "Hannah", "Felix", "Emma", "Paul", "Sofia", "Elias",
  "Leonie", "Noah", "Aylin", "Mehmet", "Olga", "Piotr", "Giulia", "Marco", "Amira", "Karim",
  "Chloé", "Julien", "Ana", "Diego", "Priya", "Arjun", "Mei", "Wei", "Zeynep", "Tobias",
];
const LAST_NAMES = [
  "Schmidt", "Müller", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Hoffmann", "Koch",
  "Yılmaz", "Kaya", "Nowak", "Kowalski", "Rossi", "Bianchi", "Haddad", "Martin", "García", "Sharma",
  "Chen", "Wang", "Petrova", "Richter", "Klein", "Wolf", "Neumann", "Schwarz", "Braun", "Krüger",
];
const EMPLOYERS = {
  permanent: ["Siemens AG", "Deutsche Bahn AG", "Zalando SE", "Charité – Universitätsmedizin Berlin", "BVG", "Vattenfall GmbH", "SAP SE", "Delivery Hero SE"],
  civil_servant: ["Land Berlin, Senatsverwaltung für Finanzen", "Bezirksamt Pankow", "Bundesministerium des Innern", "Freie Universität Berlin"],
  fixed_term: ["Humboldt-Universität zu Berlin", "Max-Planck-Gesellschaft", "N26 GmbH", "Deutsche Oper Berlin"],
  self_employed: ["Selbständig (Grafikdesign)", "Selbständig (Softwareentwicklung)", "Selbständig (Übersetzungen)", "Selbständig (Fotografie)"],
  student_with_guarantor: ["Technische Universität Berlin (Studium)", "Universität der Künste Berlin (Studium)"],
  other: ["Minijob, Einzelhandel", "Rente", "Elternzeit"],
};
const EMPLOYMENT_WEIGHTS = [
  ["permanent", 45], ["civil_servant", 10], ["fixed_term", 15], ["self_employed", 12], ["student_with_guarantor", 10], ["other", 8],
];
// Monthly net income per employment type, in EUR (one earner).
const INCOME_RANGES = {
  permanent: [2400, 4600], civil_servant: [2800, 4200], fixed_term: [2000, 3600],
  self_employed: [1800, 5200], student_with_guarantor: [900, 1400], other: [1100, 2000],
};
const NATIONALITIES = ["German", "Turkish", "Polish", "Italian", "Syrian", "French", "Spanish", "Indian", "Chinese", "Ukrainian"];
const RELIGIONS = ["none", "Protestant", "Catholic", "Muslim", "Jewish", "Orthodox", "Buddhist", "Hindu"];
const GENDERS = ["female", "male", "diverse"];
const FAMILY_PLANS = ["none stated", "planning children", "expecting a child", "no further children"];

// --- Dates and amounts, formatted without locale data so the output never varies ---------------

const pad = (number, size = 2) => String(number).padStart(size, "0");
const isoDay = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const addDays = (day, days) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000));
// "YYYY-MM" of the month `months` before `day`'s month.
function monthBefore(day, months) {
  const [year, month] = day.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 - months, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}
// 3790 → "3.790,00 EUR"
function euro(amount) {
  const [whole, cents] = amount.toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${cents} EUR`;
}

// --- One applicant ---------------------------------------------------------------------------

function weightedPick(random, weighted) {
  const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random() * total;
  for (const [value, weight] of weighted) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return weighted.at(-1)[0];
}

function applicantData(index, scenario, random) {
  const { int, pick, chance } = randomTools(random);
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const name = `${firstName} ${lastName}`;
  const firstTimeRenter = scenario === "first_time_renter";
  const employmentType = firstTimeRenter && chance(0.6) ? "student_with_guarantor" : weightedPick(random, EMPLOYMENT_WEIGHTS);

  const adults = firstTimeRenter ? 1 : scenario === "large_household" ? 2 : int(1, 2);
  const children = scenario === "large_household" ? int(3, 5) : adults === 2 && chance(0.4) ? int(1, 2) : 0;
  const childrenUpToSix = children === 0 ? 0 : int(0, Math.min(children, 2));
  const [low, high] = INCOME_RANGES[employmentType];
  const earners = adults === 2 && employmentType !== "student_with_guarantor" && chance(0.7) ? 2 : 1;
  const netHouseholdIncome = Math.round((int(low, high) + (earners === 2 ? int(1200, 3000) : 0)) / 10) * 10;
  const birthYear = firstTimeRenter ? int(1998, 2006) : int(1960, 1998);

  const slug = (text) => text.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
  return {
    id: `A-${pad(index + 1, 3)}`,
    scenario,
    name,
    firstName,
    lastName,
    email: `${slug(firstName)}.${slug(lastName)}${index + 1}@example.org`,
    phone: `+49 1${int(50, 79)} ${int(1_000_000, 9_999_999)}`,
    adults,
    children,
    childrenUpToSix,
    netHouseholdIncome,
    employmentType,
    employer: pick(EMPLOYERS[employmentType]),
    moveInDate: `${monthBefore(POOL_DATE, -int(1, 4))}-${pick(["01", "15"])}`,
    pets: chance(0.2),
    smoking: chance(0.15),
    firstTimeRenter,
    nationality: pick(NATIONALITIES),
    religion: pick(RELIGIONS),
    dateOfBirth: `${birthYear}-${pad(int(1, 12))}-${pad(int(1, 28))}`,
    gender: pick(GENDERS),
    familyPlans: pick(FAMILY_PLANS),
    // Documents
    schufaIssuedOn: addDays(POOL_DATE, scenario === "expired_schufa" ? -int(100, 270) : -int(3, 80)),
    schufaEntries:
      scenario === "negative_schufa"
        ? pick(["negativ – 2 offene Forderungen (Inkasso)", "negativ – 1 Zahlungsausfall (Ratenkredit)", "negativ – Eintrag aus Schuldnerverzeichnis"])
        : chance(0.2)
          ? pick(["geringfügig – 1 erledigte Forderung (Mobilfunkvertrag)", "geringfügig – 1 erledigter Zahlungsverzug (Versandhandel)"])
          : "keine",
    payslipFactor: scenario === "low_income" ? 0.7 + random() * 0.12 : 0.97 + random() * 0.06,
    otherName: scenario === "other_name" ? `${pick(FIRST_NAMES.filter((first) => first !== firstName))} ${lastName}` : null,
    otherNameDocument: pick(["schufa", "incomeProof", "previousLandlord"]),
    tenancyStart: `${int(2012, 2022)}-${pad(int(1, 12))}`,
    arrearsMonths: int(1, 3),
    rentAtPreviousFlat: int(450, 1100),
  };
}

function frontMatter(a) {
  return [
    "---",
    `id: ${a.id}`,
    `name: ${a.name}`,
    "contact:",
    `  email: ${a.email}`,
    `  phone: "${a.phone}"`,
    "household:",
    `  adults: ${a.adults}`,
    `  children: ${a.children}`,
    `  childrenUpToSix: ${a.childrenUpToSix}`,
    `netHouseholdIncome: ${a.netHouseholdIncome}`,
    "employment:",
    `  type: ${a.employmentType}`,
    `  employer: ${a.employer}`,
    `moveInDate: ${a.moveInDate}`,
    `pets: ${a.pets}`,
    `smoking: ${a.smoking}`,
    `firstTimeRenter: ${a.firstTimeRenter}`,
    "# Declared, but must not be used to select an applicant (AGG):",
    `nationality: ${a.nationality}`,
    `religion: ${a.religion}`,
    `dateOfBirth: ${a.dateOfBirth}`,
    `gender: ${a.gender}`,
    `photo: photos/${a.id}.jpg`,
    `familyPlans: ${a.familyPlans}`,
    "---",
  ].join("\n");
}

// The name printed on a document: the applicant's, or another person's on the chosen document.
const nameOn = (a, document) => (a.otherName && a.otherNameDocument === document ? a.otherName : a.name);

function schufaSection(a) {
  const score = a.schufaEntries.startsWith("negativ") ? "58,4 %" : a.schufaEntries.startsWith("geringfügig") ? "91,3 %" : "97,6 %";
  return [
    `## ${DOCUMENT_HEADINGS.schufa}`,
    "",
    "SCHUFA-BonitätsAuskunft",
    `Name: ${nameOn(a, "schufa")}`,
    `Ausstellungsdatum: ${a.schufaIssuedOn}`,
    `Score: ${score}`,
    `Einträge: ${a.schufaEntries}`,
  ].join("\n");
}

function incomeProofSection(a) {
  const title = {
    self_employed: "Einkommensnachweis (betriebswirtschaftliche Auswertung)",
    student_with_guarantor: "Einkommensnachweis (BAföG-Bescheid und Minijob)",
    other: "Einkommensnachweis",
  }[a.employmentType] ?? "Gehaltsabrechnung";
  const slips = [3, 2, 1].map((monthsAgo, i) => {
    const net = Math.round(a.netHouseholdIncome * a.payslipFactor + (i - 1) * 15);
    return [title, `Name: ${nameOn(a, "incomeProof")}`, `Arbeitgeber: ${a.employer}`, `Monat: ${monthBefore(POOL_DATE, monthsAgo)}`, `Netto: ${euro(net)}`].join("\n");
  });
  if (a.employmentType === "student_with_guarantor") {
    slips.push(`Bürgschaftserklärung\nBürge: ${a.lastName === "Müller" ? "Petra" : "Thomas"} ${a.lastName} (Elternteil)`);
  }
  return [`## ${DOCUMENT_HEADINGS.incomeProof}`, "", slips.join("\n\n")].join("\n");
}

function previousLandlordSection(a) {
  const arrears = a.scenario === "arrears";
  return [
    `## ${DOCUMENT_HEADINGS.previousLandlord}`,
    "",
    arrears ? "Vormieterbescheinigung" : "Mietschuldenfreiheitsbescheinigung",
    `Name: ${nameOn(a, "previousLandlord")}`,
    `Mietzeitraum: ${a.tenancyStart} bis ${monthBefore(POOL_DATE, 0)}`,
    `Mietrückstände: ${arrears ? `ja – ${a.arrearsMonths} Monatsmieten (${euro(a.arrearsMonths * a.rentAtPreviousFlat)}) offen` : "nein"}`,
  ].join("\n");
}

function applicantFile(a) {
  const sections = [];
  if (a.scenario !== "missing_schufa") sections.push(schufaSection(a));
  sections.push(incomeProofSection(a));
  if (!a.firstTimeRenter) sections.push(previousLandlordSection(a));
  return `${frontMatter(a)}\n\n${sections.join("\n\n")}\n`;
}

// generateApplicantPool({ seed }) → [{ file, content }]: about 40 applicant files (Markdown with
// front matter), in id order. The same seed always gives byte-identical files.
export function generateApplicantPool({ seed = DEFAULT_POOL_SEED } = {}) {
  const random = seededRandom(seed);
  const scenarios = randomTools(random).shuffle(
    Object.entries(SCENARIO_COUNTS).flatMap(([scenario, count]) => Array(count).fill(scenario)),
  );
  return scenarios.map((scenario, index) => {
    const applicant = applicantData(index, scenario, random);
    return { file: `${applicant.id}.md`, content: applicantFile(applicant) };
  });
}
