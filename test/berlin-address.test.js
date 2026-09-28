import test from "node:test";
import assert from "node:assert/strict";

import {
  AddressInputError,
  buildWfsUrl,
  parseAddressInput,
  verifyBerlinAddress,
} from "../src/berlin-address.js";

test("parses and normalizes a Berlin address", () => {
  assert.deepEqual(
    parseAddressInput({
      street: "  Pariser Platz ",
      houseNumber: " 1 a ",
      postalCode: "10117",
    }),
    {
      street: "Pariser Platz",
      houseNumber: 1,
      houseNumberSuffix: "a",
      postalCode: "10117",
    },
  );
});

test("parses a pasted multi-line Berlin address", () => {
  assert.deepEqual(
    parseAddressInput({
      address: "Berliner Straße 155\n10715 Berlin-Bezirk Charlottenburg-Wilmersdorf",
    }),
    {
      street: "Berliner Straße",
      houseNumber: 155,
      houseNumberSuffix: "",
      postalCode: "10715",
    },
  );
});

test("rejects input outside the Berlin postcode range", () => {
  assert.throws(
    () =>
      parseAddressInput({
        street: "Musterstraße",
        houseNumber: "1",
        postalCode: "20095",
      }),
    (error) =>
      error instanceof AddressInputError &&
      error.details.some((detail) => detail.field === "postalCode"),
  );
});

test("escapes user text in the WFS filter", () => {
  const url = new URL(
    buildWfsUrl({
      street: "O'Brien-Straße",
      houseNumber: 4,
      houseNumberSuffix: "",
      postalCode: "10115",
    }),
  );

  assert.equal(url.hostname, "gdi.berlin.de");
  assert.match(url.searchParams.get("CQL_FILTER"), /O''Brien-Straße/);
  assert.match(url.searchParams.get("CQL_FILTER"), /hnr=4/);
  assert.match(url.searchParams.get("CQL_FILTER"), /plz='10115'/);
});

test("returns a verified official Berlin address with building age, rent tier, and occupancy", async () => {
  const fetchImpl = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("wohnlagenadr2026")) {
      return new Response(
        JSON.stringify({
          features: [
            {
              properties: {
                schluessel: "42191001",
                strasse: "Pariser Platz",
                hnr: "1",
                plz: "10117",
                wol: "gut",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (urlStr.includes("ua_gebaeudealter")) {
      return new Response(
        JSON.stringify({
          features: [
            {
              properties: {
                schluessel: "0900431581000000",
                ueberw_dekade_woh_neu: "1991-2000",
                typklar: "Blockrandbebauung",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        features: [
          {
            geometry: { type: "Point", coordinates: [13.37802888, 52.51587144] },
            properties: {
              adressid: "147765",
              hnr: 1,
              hnr_zusatz: null,
              str_name: "Pariser Platz",
              plz: "10117",
              bez_name: "Mitte",
              ort_name: "Mitte",
              plr_name: "Wilhelmstraße",
              qualitaet: "Qualitaet A",
              adr_datum: "2008-01-28",
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await verifyBerlinAddress(
    {
      street: "pariser platz",
      houseNumber: "1",
      postalCode: "10117",
      livingAreaSqm: 50,
      rooms: 2,
      occupants: 2,
      childrenUpToSix: 0,
    },
    { fetchImpl },
  );

  assert.equal(result.verified, true);
  assert.equal(result.address.officialId, "147765");
  assert.equal(result.address.district, "Mitte");
  assert.equal(result.address.residentialLocation, "gut");
  assert.deepEqual(result.address.rentTier, {
    locationCategory: "gut",
    monetaryRentVerified: false,
    note: "Wohnlage is a Mietspiegel location category, not a rent amount.",
  });
  assert.deepEqual(result.address.buildingAge, {
    verificationStatus: "area_class_only",
    exactBuildingAgeVerified: false,
    exactBuildingYear: null,
    areaBuildingAgeClass: "1991-2000",
    predominantAreaConstructionPeriod: "1991-2000",
    areaKey: "0900431581000000",
    urbanStructure: "Blockrandbebauung",
    granularity: "block_or_partial_block",
    referenceYear: 2015,
    note: "Official predominant construction period for the block or partial block; exact building-level construction year is not verified.",
  });
  assert.deepEqual(result.address.coordinates, {
    longitude: 13.37802888,
    latitude: 52.51587144,
  });
  assert.equal(result.occupancyAssessment.status, "meets_minimum");
  assert.equal(result.occupancyAssessment.meetsMinimum, true);
  assert.equal(result.occupancyAssessment.requiredAreaSqm, 18);
  assert.equal(result.occupancyAssessment.areaMarginSqm, 32);
  assert.equal(result.occupancyAssessment.occupantsPerRoom, 1);
  assert.equal(result.occupancyAssessment.roomsPerOccupant, 1);
  assert.equal(result.mietspiegel.status, "calculated");
  assert.equal(result.mietspiegel.field, "H4");
  assert.equal(result.mietspiegel.residentialLocation, "gut");
  assert.equal(result.mietspiegel.buildingAge, "1991–2001");
  assert.equal(result.mietspiegel.sizeCategory, "40–60 m²");
  assert.equal(result.sources.residentialLocation.name, "Wohnlagen nach Adressen zum Berliner Mietspiegel 2026 - WFS");
  assert.equal(result.sources.buildingAge.name, "Gebäudealter der Wohnbebauung (Umweltatlas) - WFS");
  assert.equal(result.sources.occupancyLaw.name, "§ 7 WoAufG Bln");
  assert.equal(result.sources.mietspiegel.name, "Berliner Mietspiegel 2026");
});

test("evaluates address-specific Mietspiegel reference rent range matching field D4 example", async () => {
  const fetchImpl = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("wohnlagenadr2026")) {
      return new Response(
        JSON.stringify({
          features: [
            {
              properties: {
                schluessel: "42191001",
                strasse: "Pariser Platz",
                hnr: "1",
                plz: "10117",
                wol: "gut",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        features: [
          {
            geometry: { type: "Point", coordinates: [13.378, 52.515] },
            properties: {
              adressid: "147765",
              hnr: 1,
              hnr_zusatz: null,
              str_name: "Pariser Platz",
              plz: "10117",
              bez_name: "Mitte",
              ort_name: "Mitte",
              plr_name: "Wilhelmstraße",
              qualitaet: "Qualitaet A",
              adr_datum: "2008-01-28",
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await verifyBerlinAddress(
    {
      street: "pariser platz",
      houseNumber: "1",
      postalCode: "10117",
      buildingAge: "1919–1949",
      livingAreaSqm: 50,
      contractRent: 500,
    },
    { fetchImpl },
  );

  assert.equal(result.verified, true);
  assert.deepEqual(result.mietspiegel, {
    status: "calculated",
    buildingAge: "1919–1949",
    residentialLocation: "gut",
    sizeCategory: "40–60 m²",
    field: "D4",
    rentPerSqm: {
      lower: 8.2,
      median: 9.45,
      upper: 11.1,
    },
    monthlyReferenceRent: {
      lower: 410.0,
      median: 472.5,
      upper: 555.0,
    },
    currency: "EUR",
    basis: "net cold rent",
    contractRentComparison: {
      actualMonthlyRent: 500,
      actualRentPerSqm: 10,
      status: "within",
      differenceFromMedian: 27.5,
      differenceFromThreshold: 0,
      summary: "The contractual rent is within the official Mietspiegel reference range.",
    },
    source: {
      name: "Berliner Mietspiegel 2026",
      publisher: "Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen Berlin",
      catalogUrl:
        "https://daten.berlin.de/datensaetze/wohnlagen-nach-adressen-zum-berliner-mietspiegel-2026-wfs-809faebe",
      legalBasis: "§§ 558c, 558d BGB",
      basis: "net cold rent",
      currency: "EUR",
    },
  });
});

test("does not accept a different house-number suffix", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        features: [
          {
            geometry: { type: "Point", coordinates: [13.4, 52.5] },
            properties: {
              adressid: "42",
              hnr: 12,
              hnr_zusatz: "A",
              str_name: "Musterstraße",
              plz: "10115",
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const result = await verifyBerlinAddress(
    { street: "Musterstraße", houseNumber: "12b", postalCode: "10115" },
    { fetchImpl },
  );

  assert.deepEqual(result, { verified: false, address: null });
});

test("reports an unavailable upstream service", async () => {
  const fetchImpl = async () => new Response("unavailable", { status: 503 });

  await assert.rejects(
    verifyBerlinAddress(
      { street: "Pariser Platz", houseNumber: "1", postalCode: "10117" },
      { fetchImpl },
    ),
    /Berlin address service returned 503/,
  );
});
