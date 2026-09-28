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
    },
  );
});
