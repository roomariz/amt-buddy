// Evidence: one entry per Tool call made during a turn,
// `{ tool, args, result }` on success or `{ tool, args, error: { kind, message } }`.

function formatAddress(address) {
  return `${address.street} ${address.houseNumber}, ${address.postalCode} Berlin`;
}

// Tenancy fact updates implied by successful Tool results. Compliance results
// are verdicts, not facts, and add nothing here.
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
  }
  return updates;
}
