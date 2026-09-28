import { parseNumber } from "./numbers.js";

// Facts the user (or a lease) can state about their Tenancy.
export const STATED_FACTS = [
  "address",
  "livingAreaSqm",
  "contractRent",
  "buildingYear",
  "rooms",
  "occupants",
  "childrenUpToSix",
];

// Facts only official data supplies; they belong to the current address.
export const OFFICIAL_ONLY_FACTS = ["coordinates", "residentialLocation"];

export const TENANCY_FACTS = [...STATED_FACTS, ...OFFICIAL_ONLY_FACTS];

const NUMERIC_FACTS = new Set(["livingAreaSqm", "contractRent", "rooms", "occupants", "childrenUpToSix"]);
const SOURCE_RANK = { official: 1, lease: 2, user: 3 };

// Lease facts below this confidence are Unconfirmed facts until the user confirms them.
export const CONFIDENCE_THRESHOLD = 0.8;

export function isUnconfirmed(fact) {
  return fact?.source === "lease" && (fact.confidence ?? 0) < CONFIDENCE_THRESHOLD;
}

// Numeric facts accept numbers or German/English numeric strings ("720,50");
// anything unparsable yields undefined and the update is ignored.
function coerce(name, value) {
  if (NUMERIC_FACTS.has(name)) {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    return parseNumber(String(value).trim()) ?? undefined;
  }
  if (name === "buildingYear" && /^\d{4}$/.test(String(value).trim())) return Number(value);
  return value;
}

function clearAddressDerivedFacts(tenancy) {
  for (const name of OFFICIAL_ONLY_FACTS) delete tenancy[name];
  if (tenancy.buildingYear?.source === "official") delete tenancy.buildingYear;
}

function rank(fact) {
  // A Canonical address keeps the precedence of the statement it canonicalised.
  if (fact.source === "official" && fact.statedBy) return SOURCE_RANK[fact.statedBy];
  return SOURCE_RANK[fact.source];
}

// Applies Tenancy fact updates in order. Precedence: user > lease > official;
// at equal rank the latest update wins. An official address (the Canonical address)
// always replaces the stated one and keeps the stated source's rank in `statedBy`.
// A replaced address invalidates the facts derived from the old one.
export function mergeTenancy(current, updates) {
  const next = { ...current };
  for (const { fact: name, value, source, confidence } of updates) {
    if (!TENANCY_FACTS.includes(name) || value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    const coerced = coerce(name, value);
    if (coerced === undefined) continue;
    const incoming = { value: coerced, source };
    if (confidence !== undefined) incoming.confidence = confidence;
    const existing = next[name];

    if (name === "address" && source === "official") {
      const statedBy = existing?.statedBy ?? (existing && existing.source !== "official" ? existing.source : undefined);
      if (existing?.value !== incoming.value) clearAddressDerivedFacts(next);
      next.address = statedBy ? { ...incoming, statedBy } : incoming;
      continue;
    }

    if (existing && SOURCE_RANK[source] < rank(existing)) continue;
    if (name === "address" && existing?.value !== incoming.value) clearAddressDerivedFacts(next);
    next[name] = incoming;
  }
  return next;
}

export function tenancyReducer(current, updates) {
  if (updates === null) return {};
  return mergeTenancy(current, updates);
}

// Plain values of every fact a Sub-agent may rely on (Unconfirmed facts excluded).
export function confirmedValues(tenancy) {
  return Object.fromEntries(
    Object.entries(tenancy)
      .filter(([, fact]) => !isUnconfirmed(fact))
      .map(([name, fact]) => [name, fact.value]),
  );
}
