import test from "node:test";
import assert from "node:assert/strict";

import { buildBuildingAgeWfsUrl, getBerlinBuildingAgeArea } from "../src/berlin-building-age.js";

test("builds a spatial building-age query around verified coordinates", () => {
  const url = new URL(
    buildBuildingAgeWfsUrl({ longitude: 13.32951181, latitude: 52.4872404 }),
  );

  assert.equal(url.pathname, "/services/wfs/ua_gebaeudealter");
  assert.equal(url.searchParams.get("typeNames"), "ua_gebaeudealter:ua_gebaeudealter_baualter");
  assert.match(url.searchParams.get("bbox"), /13\.329/);
  assert.match(url.searchParams.get("bbox"), /EPSG:4326/);
});

test("returns the official predominant block-level construction period", async () => {
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        features: [
          {
            properties: {
              schluessel: "0900431581000000",
              ueberw_dekade_woh_neu: "1951-1960",
              typklar: "Heterogene, innerstädtische Mischbebauung, Lückenschluss nach 1945",
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  assert.deepEqual(
    await getBerlinBuildingAgeArea(
      { longitude: 13.32951181, latitude: 52.4872404 },
      { fetchImpl },
    ),
    {
      predominantConstructionPeriod: "1951-1960",
      areaKey: "0900431581000000",
      urbanStructure: "Heterogene, innerstädtische Mischbebauung, Lückenschluss nach 1945",
      granularity: "block_or_partial_block",
      referenceYear: 2015,
      buildingSpecific: false,
      mostCommonDecade: null,
    },
  );
});

function blockResponse(properties) {
  return async () =>
    new Response(JSON.stringify({ features: [{ properties }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

test("a block of mixed construction periods names the decade with the most buildings; a tie goes to the older one", async () => {
  const coordinates = { longitude: 13.3321, latitude: 52.4868 };
  const mixed = {
    ueberw_dekade_woh_neu: "gemischte Baualtersklasse",
    x_bis_1900: 1,
    x1951_1960: 4,
    x1961_1970: 4,
    x1971_1980: 1,
    x2011_2015: null,
  };

  const area = await getBerlinBuildingAgeArea(coordinates, { fetchImpl: blockResponse(mixed) });
  assert.equal(area.predominantConstructionPeriod, "gemischte Baualtersklasse");
  assert.equal(area.mostCommonDecade, "1951-1960");

  const older = await getBerlinBuildingAgeArea(coordinates, {
    fetchImpl: blockResponse({ ...mixed, x_bis_1900: 7 }),
  });
  assert.equal(older.mostCommonDecade, "bis 1900");
});
