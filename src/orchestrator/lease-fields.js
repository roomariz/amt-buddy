// Maps the lease OCR result (parseTenancyDocument in src/ocr-extraction.js) to the
// extract_lease_data contract: `{ name: { value, confidence } }`, only for what the lease states.
// Confidence values are passed through unchanged, so low ones become Unconfirmed facts.
const NUMERIC_FIELDS = ["livingAreaSqm", "contractRent", "rooms", "buildingYear", "occupants", "childrenUpToSix"];

function leaseAddress({ address, street, houseNumber }) {
  // The OCR writes a two-line address ("Street 1\n10245 Berlin"); the Tenancy uses one line.
  if (address) return address.replace(/\s*\n\s*/g, ", ");
  if (street && houseNumber) return `${street} ${houseNumber}`;
  return undefined;
}

export function leaseFieldsFromOcr({ fields = {}, confidence = {} } = {}) {
  const result = {};
  const address = leaseAddress(fields);
  if (address) result.address = { value: address, confidence: confidence.address ?? 0 };
  for (const name of NUMERIC_FIELDS) {
    const value = fields[name];
    if (typeof value === "number" && Number.isFinite(value)) {
      result[name] = { value, confidence: confidence[name] ?? 0 };
    }
  }
  return result;
}
