import { STATED_FACTS } from "./tenancy.js";

// Evidence: one entry per Tool call made during a turn,
// `{ tool, args, result }` on success or `{ tool, args, error: { kind, message } }`.

function formatAddress(address) {
  return `${address.street} ${address.houseNumber}, ${address.postalCode} Berlin`;
}

// Tenancy fact updates implied by successful Tool results. Compliance results
// are verdicts, not facts, and add nothing here. Lease values keep their confidence,
// so those below the threshold become Unconfirmed facts.
export function factsFromEvidence(evidence) {
  const updates = [];
  for (const { tool, result } of evidence) {
    if (!result) continue;
    if (tool === "validate_berlin_address" && result.verified && result.address) {
      updates.push({ fact: "address", value: formatAddress(result.address), source: "official" });
      updates.push({ fact: "coordinates", value: result.address.coordinates, source: "official" });
      updates.push({ fact: "residentialLocation", value: result.address.residentialLocation, source: "official" });
    }
    if (tool === "lookup_building_age") {
      updates.push({ fact: "buildingYear", value: result.predominantConstructionPeriod, source: "official" });
    }
    if (tool === "extract_lease_data") {
      for (const [fact, extracted] of Object.entries(result.fields ?? {})) {
        if (!STATED_FACTS.includes(fact) || !extracted) continue;
        updates.push({ fact, value: extracted.value, source: "lease", confidence: extracted.confidence });
      }
    }
  }
  return updates;
}

// True when a Tool result in the evidence is a Compliance verdict: a calculated
// Mietspiegel range or a § 7 WoAufG Bln occupancy assessment.
export function hasComplianceVerdict(evidence) {
  return evidence.some(
    ({ tool, result }) =>
      (tool === "calculate_mietspiegel" && result?.status === "calculated") ||
      (tool === "assess_occupancy_compliance" && ["meets_minimum", "below_minimum"].includes(result?.status)),
  );
}
