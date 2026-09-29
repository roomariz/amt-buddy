// The Listing form and the Rent check display of the /landlord page, as plain data (no DOM).

const FIELDS = ["address", "livingAreaSqm", "rooms", "askingRent", "buildingYear"];

// "52,5", "1.200" and "1.200,50" (German) or "52.5" (English) → a number; anything else stays the
// text it was, so the server's validation names the field.
function parseNumber(text) {
  const trimmed = String(text ?? "").trim();
  const germanThousands = /^\d{1,3}(\.\d{3})+$/.test(trimmed);
  const normalized =
    trimmed.includes(",") || germanThousands ? trimmed.replaceAll(".", "").replace(",", ".") : trimmed;
  const number = Number(normalized);
  return normalized && /^[\d.]+$/.test(normalized) && Number.isFinite(number) ? number : trimmed;
}

// The form's text fields → the body of PUT /api/v1/landlord/:landlordId/listing.
// An empty building year is left out (it is optional).
export function listingRequest(values) {
  const request = {
    address: String(values.address ?? "").trim(),
    livingAreaSqm: parseNumber(values.livingAreaSqm),
    rooms: parseNumber(values.rooms),
    askingRent: parseNumber(values.askingRent),
  };
  const buildingYear = parseNumber(values.buildingYear);
  if (buildingYear !== "") request.buildingYear = buildingYear;
  return request;
}

// A saved Listing (or null) → the form's text fields.
export function listingFormValues(listing) {
  return Object.fromEntries(
    FIELDS.map((field) => [field, listing?.[field] === null || listing?.[field] === undefined ? "" : String(listing[field])]),
  );
}

const PADDING = 0.05; // of the bar's span, on each side, so no mark sits on the very edge

// The Rent check → the range bar: every amount as a percentage along the bar (lower, median,
// Mietspiegel + 10 %, upper and the asking rent), where the asking rent sits (low / typical /
// high) and the warning with the allowed rent when the asking rent is above Mietspiegel + 10 %.
export function rentCheckView(rentCheck) {
  const { askingRent, range, allowedRent, aboveCap, position, differenceFromAllowed } = rentCheck;
  const amounts = [range.lower, range.upper, askingRent, allowedRent];
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  const span = high - low || 1;
  const start = low - span * PADDING;
  const width = span * (1 + 2 * PADDING);
  const percent = (amount) => Math.round(((amount - start) / width) * 1000) / 10;
  return {
    lowerPercent: percent(range.lower),
    medianPercent: percent(range.median),
    upperPercent: percent(range.upper),
    allowedPercent: percent(allowedRent),
    askingPercent: percent(askingRent),
    position,
    warning: aboveCap ? { allowedRent, excess: differenceFromAllowed } : null,
  };
}
