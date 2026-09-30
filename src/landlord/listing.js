import { AddressInputError, lookupBerlinAddress, parseAddressInput } from "../berlin-address.js";
import { getBerlinBuildingAgeArea } from "../berlin-building-age.js";
import { evaluateMietspiegel, MIETSPIEGEL_SOURCE, normalizeBuildingAgeCategory } from "../berlin-mietspiegel.js";
import { getBerlinResidentialLocation } from "../berlin-residential-location.js";
import { tidyChatAddress } from "../orchestrator/berlin-tools.js";

export class ListingInputError extends Error {
  constructor(details) {
    super(details[0]?.message ?? "Listing input is invalid.");
    this.name = "ListingInputError";
    this.details = details;
  }
}

const MAX_ADDRESS_LENGTH = 300;
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNumberIn = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value > min && value <= max;

// Checks the Listing form's fields; returns the validation problems (none: the input is usable).
function listingProblems(input) {
  if (!isPlainObject(input)) return [{ field: "body", code: "invalid_type", message: "Body must be a JSON object." }];
  const { address, livingAreaSqm, rooms, askingRent, buildingYear } = input;
  const problems = [];
  if (typeof address !== "string" || !address.trim() || address.length > MAX_ADDRESS_LENGTH) {
    problems.push({
      field: "address",
      code: "required",
      message: `'address' must be a non-empty string of at most ${MAX_ADDRESS_LENGTH} characters.`,
    });
  }
  if (!isNumberIn(livingAreaSqm, 0, 1_000)) {
    problems.push({ field: "livingAreaSqm", code: "invalid_value", message: "'livingAreaSqm' must be a number of m² above 0 and at most 1000." });
  }
  if (!isNumberIn(rooms, 0, 20)) {
    problems.push({ field: "rooms", code: "invalid_value", message: "'rooms' must be a number above 0 and at most 20." });
  }
  if (!isNumberIn(askingRent, 0, 100_000)) {
    problems.push({ field: "askingRent", code: "invalid_value", message: "'askingRent' must be a monthly net cold rent in EUR above 0 and at most 100000." });
  }
  const latestYear = new Date().getFullYear() + 5;
  if (buildingYear !== undefined && buildingYear !== null && !(Number.isInteger(buildingYear) && buildingYear >= 1800 && buildingYear <= latestYear)) {
    problems.push({ field: "buildingYear", code: "invalid_value", message: `'buildingYear' must be a year between 1800 and ${latestYear}.` });
  }
  return problems;
}

// The address as street, house number and postal code; the form accepts it the way the chat does
// ("Wühlischstr. 30 10245" as well as "Wühlischstraße 30, 10245 Berlin").
function parseListingAddress(address) {
  try {
    return parseAddressInput({ address: tidyChatAddress(address) });
  } catch (error) {
    if (!(error instanceof AddressInputError)) throw error;
    throw new ListingInputError(
      error.details.map((detail) => ({
        ...detail,
        field: "address",
        message:
          detail.field === "address"
            ? "The address needs street, house number and postal code, e.g. 'Wühlischstraße 30, 10245 Berlin'."
            : detail.message,
      })),
    );
  }
}

// Checks only the given fields of a Listing (the chat's flat details come a few at a time), the
// way buildListing does and with its messages. Throws ListingInputError.
export function checkListingFields(input, fields) {
  const problems = listingProblems(input).filter(({ field }) => fields.includes(field));
  if (problems.length > 0) throw new ListingInputError(problems);
  if (fields.includes("address")) parseListingAddress(input.address);
}

const NOTES = {
  addressNotVerified: {
    code: "address_not_verified",
    message: "The official Berlin address register has no such address. Check street, house number and postal code.",
  },
  serviceUnavailable: {
    code: "berlin_data_service_unavailable",
    message: "An official Berlin data service is temporarily unavailable, so the Rent check could not be done. Save the Listing again later.",
  },
};

const POSITIONS = { below: "low", within: "typical", above: "high" };

// The Rent check: the Mietspiegel result for the asking rent, as the landlord page shows it.
function rentCheckOf(mietspiegel) {
  const comparison = mietspiegel.contractRentComparison;
  const cap = mietspiegel.rentCap;
  return {
    askingRent: comparison.actualMonthlyRent,
    askingRentPerSqm: comparison.actualRentPerSqm,
    range: mietspiegel.monthlyReferenceRent,
    rangePerSqm: mietspiegel.rentPerSqm,
    position: POSITIONS[comparison.status],
    aboveCap: cap.status === "above_cap",
    allowedRent: cap.capMonthlyRent,
    differenceFromAllowed: cap.differenceFromCap,
    capPercent: cap.capPercent,
    mietspiegelField: mietspiegel.field,
    buildingAgeClass: mietspiegel.buildingAge,
    residentialLocation: mietspiegel.residentialLocation,
    legalBasis: cap.legalBasis,
    source: MIETSPIEGEL_SOURCE,
  };
}

// The Mietspiegel building-age class the Rent check uses, and where it comes from: the landlord's
// building year, else the block's predominant period, else (a block of mixed periods) the decade
// with the most buildings in the block. Null when none maps to a class.
function buildingAgeOf(buildingYear, area) {
  const candidates = [
    { value: buildingYear, source: "building_year", decade: null },
    { value: area?.predominantConstructionPeriod, source: "block_period", decade: null },
    { value: area?.mostCommonDecade, source: "block_most_common_decade", decade: area?.mostCommonDecade },
  ];
  for (const { value, source, decade } of candidates) {
    const ageClass = value ? normalizeBuildingAgeCategory(value) : null;
    if (ageClass) return { class: ageClass, source, decade: decade ?? null };
  }
  return null;
}

// Builds a Listing from the landlord's form: verifies the address in the official Berlin
// register, looks up its Wohnlage and building-age period, and runs the Mietspiegel / Rent cap
// calculation with the asking rent as contract rent on a flat rented before (a re-let).
// Throws ListingInputError for input it cannot use. An address the register does not know, or a
// Berlin service that fails, gives a Listing without a Rent check and a `note` saying why.
// `fetchImpl` replaces the global fetch for the Berlin services.
export async function buildListing(input, { fetchImpl } = {}) {
  const problems = listingProblems(input);
  if (problems.length > 0) throw new ListingInputError(problems);
  const parsedAddress = parseListingAddress(input.address);

  const listing = {
    address: input.address.trim(),
    canonicalAddress: null,
    addressVerified: false,
    livingAreaSqm: input.livingAreaSqm,
    rooms: input.rooms,
    askingRent: input.askingRent,
    buildingYear: input.buildingYear ?? null,
    residentialLocation: null,
    buildingAgePeriod: null,
    buildingAge: null,
    rentCheck: null,
    note: null,
    updatedAt: new Date().toISOString(),
  };

  let official;
  try {
    official = await lookupBerlinAddress(parsedAddress, { fetchImpl });
  } catch {
    return { ...listing, note: NOTES.serviceUnavailable };
  }
  if (!official) return { ...listing, note: NOTES.addressNotVerified };

  const { street, houseNumber, postalCode, city, district, locality, coordinates } = official;
  listing.canonicalAddress = { street, houseNumber, postalCode, city, district, locality, coordinates };
  listing.addressVerified = true;

  const [location, buildingAge] = await Promise.allSettled([
    getBerlinResidentialLocation(official, { fetchImpl }),
    getBerlinBuildingAgeArea(coordinates, { fetchImpl }),
  ]);
  listing.residentialLocation = location.value?.classification ?? null;
  listing.buildingAgePeriod = buildingAge.value?.predominantConstructionPeriod ?? null;
  listing.buildingAge = buildingAgeOf(listing.buildingYear, buildingAge.value);
  // A stated building year replaces the block's period, so only then can its lookup fail unharmed.
  if (location.status === "rejected" || (buildingAge.status === "rejected" && listing.buildingYear === null)) {
    return { ...listing, note: NOTES.serviceUnavailable };
  }

  const mietspiegel = evaluateMietspiegel({
    residentialLocation: listing.residentialLocation,
    buildingAgeOrYear: listing.buildingAge?.class,
    livingAreaSqm: listing.livingAreaSqm,
    contractRent: listing.askingRent,
    rentedBefore: true,
  });
  if (mietspiegel.status !== "calculated") {
    return { ...listing, note: { code: "rent_check_not_possible", message: mietspiegel.reason } };
  }
  return { ...listing, rentCheck: rentCheckOf(mietspiegel) };
}
