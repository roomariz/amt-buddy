import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResidentialLocationWfsUrl,
  getBerlinResidentialLocation,
} from "../src/berlin-residential-location.js";

const officialAddress = {
  street: "Berliner Straße",
  houseNumber: "155",
  postalCode: "10715",
};

test("builds a Wohnlage query from the official address", () => {
  const url = new URL(buildResidentialLocationWfsUrl(officialAddress));

  assert.equal(url.hostname, "gdi.berlin.de");
  assert.equal(url.pathname, "/services/wfs/wohnlagenadr2026");
  assert.match(url.searchParams.get("CQL_FILTER"), /strasse ILIKE 'Berliner Straße'/);
  assert.match(url.searchParams.get("CQL_FILTER"), /hnr='155'/);
  assert.match(url.searchParams.get("CQL_FILTER"), /plz='10715'/);
});

test("pads short house numbers to the Wohnlage dataset format", () => {
  const url = new URL(
    buildResidentialLocationWfsUrl({
      street: "Berliner Straße",
      houseNumber: "15",
      postalCode: "10715",
    }),
  );

  assert.match(url.searchParams.get("CQL_FILTER"), /hnr='015'/);
});

test("preserves and normalizes a house-number suffix", () => {
  const url = new URL(
    buildResidentialLocationWfsUrl({
      street: "Berliner Straße",
      houseNumber: "26a",
      postalCode: "10715",
    }),
  );

  assert.match(url.searchParams.get("CQL_FILTER"), /hnr='026A'/);
});

test("returns the official Wohnlage classification", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        features: [
          {
            properties: {
              schluessel: "00509155",
              bezname: "Charlottenburg-Wilmersdorf",
              plz: "10715",
              strasse: "Berliner Straße",
              hnr: "155",
              wol: "gut",
              stadtteil: "West",
              plr_name: "Babelsberger Straße",
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  assert.deepEqual(await getBerlinResidentialLocation(officialAddress, { fetchImpl }), {
    classification: "gut",
    datasetKey: "00509155",
  });
});

test("returns null when the verified address has no Wohnlage record", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ features: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  assert.equal(await getBerlinResidentialLocation(officialAddress, { fetchImpl }), null);
});
