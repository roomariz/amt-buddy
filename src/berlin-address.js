import {
  BERLIN_RESIDENTIAL_LOCATION_SOURCE,
  getBerlinResidentialLocation,
} from "./berlin-residential-location.js";
import { BERLIN_BUILDING_AGE_SOURCE, getBerlinBuildingAgeArea } from "./berlin-building-age.js";
import { assessOccupancy, OCCUPANCY_LAW_SOURCE } from "./occupancy-assessment.js";
import { evaluateMietspiegel, MIETSPIEGEL_SOURCE } from "./berlin-mietspiegel.js";

const WFS_ENDPOINT = "https://gdi.berlin.de/services/wfs/adressen_berlin";

export const BERLIN_ADDRESS_SOURCE = {
  name: "Adressen Berlin - WFS",
  publisher: "Amt für Statistik Berlin-Brandenburg",
  license: "Datenlizenz Deutschland – Zero – Version 2.0",
  catalogUrl: "https://daten.berlin.de/datensaetze/adressen-berlin-wfs-634ab8ba",
};

export class AddressInputError extends Error {
  constructor(details) {
    super("Address input is invalid");
    this.name = "AddressInputError";
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
}

function comparable(value) {
  return normalizeText(value).toLocaleLowerCase("de-DE");
}

export function parseAddressInput(input) {
  const details = [];
  let streetInput = input?.street;
  let houseNumberInput = input?.houseNumber;
  let postalCodeInput = input?.postalCode;
  const pastedAddress = String(input?.address ?? "");

  if (pastedAddress.trim()) {
    const match = /^\s*(.+?)[ \t]+(\d{1,4}[ \t]*[a-z]?)[ \t]*(?:,|[\r\n]+)[ \t]*(\d{5})(?:[ \t]+[^\r\n]+)?\s*$/iu.exec(
      pastedAddress,
    );

    if (!match) {
      throw new AddressInputError([
        {
          field: "address",
          code: "invalid_format",
          message: "Enter the address on two lines, for example: Pariser Platz 1 / 10117 Berlin.",
        },
      ]);
    }

    [, streetInput, houseNumberInput, postalCodeInput] = match;
  }

  const street = normalizeText(streetInput);
  houseNumberInput = normalizeText(houseNumberInput);
  const postalCode = normalizeText(postalCodeInput);

  if (street.length < 2 || street.length > 120) {
    details.push({
      field: "street",
      code: "invalid_length",
      message: "Street must contain between 2 and 120 characters.",
    });
  }

  const houseNumberMatch = /^(\d{1,4})\s*([a-z])?$/iu.exec(houseNumberInput);
  if (!houseNumberMatch) {
    details.push({
      field: "houseNumber",
      code: "invalid_format",
      message: "House number must be a number with an optional letter suffix.",
    });
  }

  const postalCodeNumber = Number(postalCode);
  if (!/^\d{5}$/.test(postalCode) || postalCodeNumber < 10115 || postalCodeNumber > 14199) {
    details.push({
      field: "postalCode",
      code: "outside_berlin",
      message: "Postal code must be within Berlin's 10115–14199 range.",
    });
  }

  if (details.length > 0) {
    throw new AddressInputError(details);
  }

  return {
    street,
    houseNumber: Number(houseNumberMatch[1]),
    houseNumberSuffix: (houseNumberMatch[2] ?? "").toLocaleLowerCase("de-DE"),
    postalCode,
  };
}

function escapeCqlString(value) {
  return value.replaceAll("'", "''");
}

export function buildWfsUrl(address) {
  const url = new URL(WFS_ENDPOINT);
  const filter = [
    `str_name ILIKE '${escapeCqlString(address.street)}'`,
    `hnr=${address.houseNumber}`,
    `plz='${address.postalCode}'`,
  ].join(" AND ");

  url.search = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: "adressen_berlin:adressen_berlin",
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    count: "10",
    CQL_FILTER: filter,
  }).toString();

  return url.toString();
}

function matchesAddress(feature, address) {
  const properties = feature?.properties ?? {};
  const suffix = normalizeText(properties.hnr_zusatz).toLocaleLowerCase("de-DE");

  return (
    comparable(properties.str_name) === comparable(address.street) &&
    Number(properties.hnr) === address.houseNumber &&
    suffix === address.houseNumberSuffix &&
    String(properties.plz) === address.postalCode
  );
}

function mapFeature(feature) {
  const properties = feature.properties;
  const [longitude, latitude] = feature.geometry?.coordinates ?? [];
  const suffix = normalizeText(properties.hnr_zusatz);

  return {
    officialId: properties.adressid,
    street: properties.str_name,
    houseNumber: `${properties.hnr}${suffix}`,
    postalCode: properties.plz,
    city: "Berlin",
    district: properties.bez_name ?? null,
    locality: properties.ort_name ?? null,
    planningArea: properties.plr_name ?? null,
    quality: properties.qualitaet ?? null,
    recordedAt: properties.adr_datum ?? null,
    coordinates:
      Number.isFinite(longitude) && Number.isFinite(latitude)
        ? { longitude, latitude }
        : null,
  };
}

export async function verifyBerlinAddress(input, options = {}) {
  const address = parseAddressInput(input);
  const occupancyAssessment = assessOccupancy(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(buildWfsUrl(address), {
    headers: { accept: "application/json" },
    signal: options.signal ?? AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Berlin address service returned ${response.status}`);
  }

  const collection = await response.json();
  const feature = collection.features?.find((candidate) => matchesAddress(candidate, address));

  if (!feature) {
    return { verified: false, address: null };
  }

  const verifiedAddress = mapFeature(feature);
  const [residentialLocation, buildingAgeArea] = await Promise.all([
    getBerlinResidentialLocation(verifiedAddress, {
      fetchImpl: options.residentialLocationFetchImpl ?? fetchImpl,
      signal: options.signal,
    }),
    getBerlinBuildingAgeArea(verifiedAddress.coordinates, {
      fetchImpl: options.buildingAgeFetchImpl ?? fetchImpl,
      signal: options.signal,
    }),
  ]);

  const mietspiegel = evaluateMietspiegel({
    residentialLocation: residentialLocation?.classification,
    buildingAgeOrYear:
      input?.buildingYear ??
      input?.buildingAge ??
      buildingAgeArea?.predominantConstructionPeriod,
    livingAreaSqm: input?.livingAreaSqm,
    contractRent: input?.contractRent ?? input?.actualMonthlyRent,
  });

  return {
    verified: true,
    address: {
      ...verifiedAddress,
      residentialLocation: residentialLocation?.classification ?? null,
      residentialLocationKey: residentialLocation?.datasetKey ?? null,
      rentTier: {
        locationCategory: residentialLocation?.classification ?? null,
        monetaryRentVerified: false,
        note: "Wohnlage is a Mietspiegel location category, not a rent amount.",
      },
      buildingAge: buildingAgeArea
        ? {
            verificationStatus: "area_class_only",
            exactBuildingAgeVerified: false,
            exactBuildingYear: null,
            areaBuildingAgeClass: buildingAgeArea.predominantConstructionPeriod,
            predominantAreaConstructionPeriod: buildingAgeArea.predominantConstructionPeriod,
            areaKey: buildingAgeArea.areaKey,
            urbanStructure: buildingAgeArea.urbanStructure,
            granularity: buildingAgeArea.granularity,
            referenceYear: buildingAgeArea.referenceYear,
            note: "Official predominant construction period for the block or partial block; exact building-level construction year is not verified.",
          }
        : {
            verificationStatus: "not_available",
            exactBuildingAgeVerified: false,
            exactBuildingYear: null,
            areaBuildingAgeClass: null,
            note: "No official building-age data available for these coordinates.",
          },
    },
    occupancyAssessment,
    mietspiegel,
    source: BERLIN_ADDRESS_SOURCE,
    sources: {
      address: BERLIN_ADDRESS_SOURCE,
      residentialLocation: BERLIN_RESIDENTIAL_LOCATION_SOURCE,
      buildingAge: BERLIN_BUILDING_AGE_SOURCE,
      occupancyLaw: OCCUPANCY_LAW_SOURCE,
      mietspiegel: MIETSPIEGEL_SOURCE,
    },
  };
}
