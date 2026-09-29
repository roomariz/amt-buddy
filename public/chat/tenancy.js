// The review card for Unconfirmed facts (CONTEXT.md): lease values the Orchestrator will not check
// until the user confirms or corrects them. Driven by the `tenancy` event, answered with `confirm`.

import { getLanguage, t } from "../i18n.js";

// A lease value below this confidence (or without one) is an Unconfirmed fact.
export const CONFIDENCE_THRESHOLD = 0.8;

// Tenancy facts a lease can state, in the order the card shows them. Labels live in i18n.js
// ("facts.<name>"); `unitKey` names a translated unit.
const LEASE_FACTS = [
  { name: "address", unit: "", input: "text" },
  { name: "contractRent", unitKey: "facts.perMonth", input: "decimal" },
  { name: "livingAreaSqm", unit: "m²", input: "decimal" },
  { name: "rooms", unit: "", input: "decimal" },
  { name: "buildingYear", unit: "", input: "numeric" },
  { name: "occupants", unit: "", input: "numeric" },
  { name: "childrenUpToSix", unit: "", input: "numeric" },
];

// "high" (green): at or above the threshold; "medium" (yellow): somewhat below it;
// "low" (red): 0.5 or less (the OCR's mark for an implausible value) or no confidence at all.
export function confidenceLevel(confidence) {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return "low";
  if (confidence >= CONFIDENCE_THRESHOLD) return "high";
  if (confidence > 0.5) return "medium";
  return "low";
}

// A fact's translated label and unit, as the review card and the confirm bubble show them.
function labelAndUnit({ name, unit, unitKey }) {
  return { label: t(`facts.${name}`), unit: unitKey ? t(unitKey) : unit };
}

const isUnconfirmed = (fact) =>
  fact?.source === "lease" && !(typeof fact.confidence === "number" && fact.confidence >= CONFIDENCE_THRESHOLD);

// Number format of the UI language for the input (German 780.5 → "780,5"); the server parses
// both notations back.
function displayValue(value) {
  if (typeof value !== "number") return String(value ?? "");
  return getLanguage() === "de" ? String(value).replace(".", ",") : String(value);
}

// The card's fields, or null when the Tenancy has no Unconfirmed fact. Lists every value that
// still comes from the lease, Unconfirmed ones first.
export function reviewCard(tenancy) {
  if (!tenancy || typeof tenancy !== "object") return null;
  const fields = LEASE_FACTS.filter(({ name }) => tenancy[name]?.source === "lease").map((leaseFact) => {
    const fact = tenancy[leaseFact.name];
    return {
      name: leaseFact.name,
      ...labelAndUnit(leaseFact),
      value: displayValue(fact.value),
      confidence: typeof fact.confidence === "number" ? fact.confidence : null,
      level: confidenceLevel(fact.confidence),
      unconfirmed: isUnconfirmed(fact),
    };
  });
  if (!fields.some((field) => field.unconfirmed)) return null;
  return { fields: [...fields.filter((f) => f.unconfirmed), ...fields.filter((f) => !f.unconfirmed)] };
}

// The `confirm` object for the chat request: every Unconfirmed value the user filled in, plus the
// confirmed values the user changed. `inputs` maps fact names to the fields' current text.
export function confirmPayload(fields, inputs) {
  const confirm = {};
  for (const field of fields) {
    const value = String(inputs[field.name] ?? "").trim();
    if (!value) continue;
    if (field.unconfirmed || value !== field.value) confirm[field.name] = value;
  }
  return confirm;
}

// The user bubble for a `confirm` ("Values confirmed – Nettokaltmiete: 780,50 € / Monat"), in the
// UI language and in the order sent; null when it names no lease fact. Values are shown as sent.
export function confirmedValuesText(confirm) {
  const parts = [];
  for (const [name, value] of Object.entries(confirm ?? {})) {
    const leaseFact = LEASE_FACTS.find((fact) => fact.name === name);
    if (!leaseFact) continue;
    const { label, unit } = labelAndUnit(leaseFact);
    parts.push(`${label}: ${value}${unit ? ` ${unit}` : ""}`);
  }
  return parts.length > 0 ? t("chat.confirmedValues", { summary: parts.join(", ") }) : null;
}

// The input mode for a fact's field (text, decimal or numeric keyboard).
export function inputModeFor(name) {
  return LEASE_FACTS.find((fact) => fact.name === name)?.input ?? "text";
}
