import { buildListing, checkListingFields, ListingInputError } from "./listing.js";
import { flatDetailsOf } from "./store.js";

// The flat details the chat collects (update_flat_details): saved as the landlord gives them, and
// once the Listing's four facts are known, built into the full Listing with its Rent check, the
// same way the classic page's Listing form does (buildListing).

const FIELDS = Object.keys(flatDetailsOf({}));
// What a Listing (and so its Rent check) needs; the building year is optional.
export const LISTING_FIELDS = ["address", "livingAreaSqm", "rooms", "askingRent"];

// The facts the Listing still needs, in LISTING_FIELDS' order.
export const missingForListing = (flat) => LISTING_FIELDS.filter((field) => flat[field] === null);

// What the scorer ranks for: the flat details, with the Listing's Rent check when there is one.
export function flatToRank(store, landlordId) {
  return { ...store.getFlatDetails(landlordId), rentCheck: store.getListing(landlordId)?.rentCheck ?? null };
}

// updateFlatDetails({ store, landlordId, input, fetchImpl }) → { flat, missing, listing }
// - input: any of { address, livingAreaSqm, rooms, askingRent, buildingYear }; what is left out
//   keeps its saved value.
// - flat: the saved flat details; missing: what the Listing still needs (see missingForListing).
// - listing: once nothing is missing, the Listing built and saved as the classic page's PUT listing
//   does (an address the register does not know, or a failing Berlin service, gives a Listing
//   without a Rent check and a `note`); null before.
// Each given value is checked as the Listing form checks it (the address needs a postal code), all
// before the store changes: ListingInputError with the form's messages, nothing saved.
// `fetchImpl` replaces the global fetch for the Berlin services.
export async function updateFlatDetails({ store, landlordId, input, fetchImpl }) {
  const given = FIELDS.filter((field) => input?.[field] !== undefined);
  if (given.length === 0) {
    throw new ListingInputError([{ field: "flat", code: "required", message: `Give at least one of ${FIELDS.map((field) => `'${field}'`).join(", ")}.` }]);
  }
  checkListingFields(input, given);
  const flat = { ...store.getFlatDetails(landlordId) };
  for (const field of given) flat[field] = field === "address" ? input.address.trim() : input[field];

  const missing = missingForListing(flat);
  if (missing.length > 0) {
    store.saveFlatDetails(landlordId, flat);
    return { flat, missing, listing: null };
  }
  const listing = store.saveListing(landlordId, await buildListing(flat, { fetchImpl }));
  return { flat: store.getFlatDetails(landlordId), missing, listing };
}
