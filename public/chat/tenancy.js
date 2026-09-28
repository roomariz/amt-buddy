// The review card for Unconfirmed facts (CONTEXT.md): lease values the Orchestrator will not check
// until the user confirms or corrects them. Driven by the `tenancy` event, answered with `confirm`.

// A lease value below this confidence (or without one) is an Unconfirmed fact.
export const CONFIDENCE_THRESHOLD = 0.8;

// Tenancy facts a lease can state, in the order the card shows them.
const LEASE_FACTS = [
  { name: "address", label: "Adresse", unit: "", input: "text" },
  { name: "contractRent", label: "Nettokaltmiete", unit: "€ / Monat", input: "decimal" },
  { name: "livingAreaSqm", label: "Wohnfläche", unit: "m²", input: "decimal" },
  { name: "rooms", label: "Zimmer", unit: "", input: "decimal" },
  { name: "buildingYear", label: "Baujahr", unit: "", input: "numeric" },
  { name: "occupants", label: "Personen im Haushalt", unit: "", input: "numeric" },
  { name: "childrenUpToSix", label: "Kinder bis 6 Jahre", unit: "", input: "numeric" },
];

// "high" (green): at or above the threshold; "medium" (yellow): somewhat below it;
// "low" (red): 0.5 or less (the OCR's mark for an implausible value) or no confidence at all.
export function confidenceLevel(confidence) {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return "low";
  if (confidence >= CONFIDENCE_THRESHOLD) return "high";
  if (confidence > 0.5) return "medium";
  return "low";
}

const isUnconfirmed = (fact) =>
  fact?.source === "lease" && !(typeof fact.confidence === "number" && fact.confidence >= CONFIDENCE_THRESHOLD);

// German number format for the input (780.5 → "780,5"); the server parses it back.
const displayValue = (value) => (typeof value === "number" ? String(value).replace(".", ",") : String(value ?? ""));

// The card's fields, or null when the Tenancy has no Unconfirmed fact. Lists every value that
// still comes from the lease, Unconfirmed ones first.
export function reviewCard(tenancy) {
  if (!tenancy || typeof tenancy !== "object") return null;
  const fields = LEASE_FACTS.filter(({ name }) => tenancy[name]?.source === "lease").map(
    ({ name, label, unit }) => {
      const fact = tenancy[name];
      return {
        name,
        label,
        unit,
        value: displayValue(fact.value),
        confidence: typeof fact.confidence === "number" ? fact.confidence : null,
        level: confidenceLevel(fact.confidence),
        unconfirmed: isUnconfirmed(fact),
      };
    },
  );
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

// The input mode for a fact's field (text, decimal or numeric keyboard).
export function inputModeFor(name) {
  return LEASE_FACTS.find((fact) => fact.name === name)?.input ?? "text";
}
