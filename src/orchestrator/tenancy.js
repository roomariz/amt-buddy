import { parseNumber } from "./numbers.js";

// Feature group ratings: the tenant's rating of each Mietspiegel Orientierungshilfe
// feature group (feature group → Tenancy fact). They describe the flat and building.
export const FEATURE_GROUP_RATINGS = {
  bathroom: "bathroomRating",
  kitchen: "kitchenRating",
  apartment: "apartmentRating",
  building: "buildingRating",
  surroundings: "surroundingsRating",
};
const RATING_FACTS = Object.values(FEATURE_GROUP_RATINGS);
const RATING_VALUES = ["positive", "neutral", "negative"];

// Facts the user (or a lease) can state about their Tenancy.
export const STATED_FACTS = [
  "address",
  "livingAreaSqm",
  "contractRent",
  "buildingYear",
  "rooms",
  "occupants",
  "childrenUpToSix",
  ...RATING_FACTS,
];

// Facts only official data supplies; they belong to the current address.
export const OFFICIAL_ONLY_FACTS = ["coordinates", "residentialLocation"];

export const TENANCY_FACTS = [...STATED_FACTS, ...OFFICIAL_ONLY_FACTS];

const NUMERIC_FACTS = new Set(["livingAreaSqm", "contractRent", "rooms", "occupants", "childrenUpToSix"]);
const SOURCE_RANK = { official: 1, lease: 2, user: 3 };

// Lease facts below this confidence are Unconfirmed facts until the user confirms them.
export const CONFIDENCE_THRESHOLD = 0.8;

export function isUnconfirmed(fact) {
  // A missing or non-numeric confidence counts as low.
  return fact?.source === "lease" && !(fact.confidence >= CONFIDENCE_THRESHOLD);
}

// Numeric facts accept numbers or German/English numeric strings ("720,50");
// anything unparsable yields undefined and the update is ignored.
function coerce(name, value) {
  if (NUMERIC_FACTS.has(name)) {
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    return parseNumber(String(value).trim()) ?? undefined;
  }
  if (name === "buildingYear") return coerceBuildingYear(value);
  if (RATING_FACTS.includes(name)) {
    const rating = String(value).trim().toLowerCase();
    return RATING_VALUES.includes(rating) ? rating : undefined;
  }
  return value;
}

// A building year is a year (1935, "1935") or an official construction period
// ("1921 - 1930"); anything else is ignored.
function coerceBuildingYear(value) {
  if (typeof value === "number") return Number.isInteger(value) ? value : undefined;
  const text = String(value).trim();
  if (/^\d{4}$/.test(text)) return Number(text);
  return /\d{4}/.test(text) ? text : undefined;
}

// Official facts belong to the address; feature group ratings to the flat, so
// they go only when a known address changes (`flatChanged`), not with the first one.
function clearAddressDerivedFacts(tenancy, { flatChanged }) {
  for (const name of OFFICIAL_ONLY_FACTS) delete tenancy[name];
  if (tenancy.buildingYear?.source === "official") delete tenancy.buildingYear;
  if (flatChanged) for (const name of RATING_FACTS) delete tenancy[name];
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
      // The Canonical address of a stated one is the same flat; a different Canonical address is not.
      if (existing?.value !== incoming.value) {
        clearAddressDerivedFacts(next, { flatChanged: existing?.source === "official" });
      }
      next.address = statedBy ? { ...incoming, statedBy } : incoming;
      continue;
    }

    if (existing && SOURCE_RANK[source] < rank(existing)) continue;
    // Only the user changes a verified address; a lease read again never undoes the verification.
    if (name === "address" && source === "lease" && existing?.source === "official") continue;
    if (name === "address" && existing?.value !== incoming.value) {
      clearAddressDerivedFacts(next, { flatChanged: existing !== undefined });
    }
    next[name] = incoming;
  }
  return next;
}

export function tenancyReducer(current, updates) {
  if (updates === null) return {};
  return mergeTenancy(current, updates);
}

// Tenancy fact updates for values the user confirmed or corrected on the review
// card, e.g. `{ contractRent: 780 }`: they become the user's own statements.
export function factsFromConfirm(confirm) {
  return Object.entries(confirm ?? {})
    .filter(([name]) => STATED_FACTS.includes(name))
    .map(([fact, value]) => ({ fact, value, source: "user" }));
}

// Plain values of every fact a Sub-agent may rely on (Unconfirmed facts excluded).
export function confirmedValues(tenancy) {
  return Object.fromEntries(
    Object.entries(tenancy)
      .filter(([, fact]) => !isUnconfirmed(fact))
      .map(([name, fact]) => [name, fact.value]),
  );
}
