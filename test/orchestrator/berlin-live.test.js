import test from "node:test";
import assert from "node:assert/strict";

import { createBerlinTools } from "../../src/orchestrator/berlin-tools.js";
import { assertToolsMatchContracts, TOOL_CONTRACTS } from "../../src/orchestrator/tool-contracts.js";

// Calls the real Berlin WFS services; skipped unless BERLIN_LIVE=1, so `npm test` stays offline.
// BERLIN_LIVE=1 node --test test/orchestrator/berlin-live.test.js
const live = process.env.BERLIN_LIVE === "1";

test(
  "live: the real Berlin services verify Wühlischstraße 30 and give its Wohnlage and construction period",
  { skip: live ? false : "set BERLIN_LIVE=1 to call the real Berlin services", timeout: 60_000 },
  async () => {
    const byName = assertToolsMatchContracts(createBerlinTools().tools);
    const call = async (name, args) => {
      const result = await byName.get(name).invoke(args);
      TOOL_CONTRACTS[name].output.parse(result);
      return result;
    };

    const verified = await call("validate_berlin_address", { address: "Wühlischstr. 30 10245 Berlin" });
    assert.equal(verified.verified, true);
    assert.equal(verified.address.street, "Wühlischstraße");
    assert.equal(verified.address.houseNumber, "30");
    assert.equal(verified.address.postalCode, "10245");
    assert.equal(verified.address.district, "Friedrichshain-Kreuzberg");
    assert.ok(["einfach", "mittel", "gut"].includes(verified.address.residentialLocation));

    const area = await call("lookup_building_age", verified.address.coordinates);
    assert.match(area.predominantConstructionPeriod, /\d{4}/);

    const mietspiegel = await call("calculate_mietspiegel", {
      residentialLocation: verified.address.residentialLocation,
      buildingAgeOrYear: area.predominantConstructionPeriod,
      livingAreaSqm: 50,
    });
    assert.equal(mietspiegel.status, "calculated");
  },
);
