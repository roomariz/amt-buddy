import test from "node:test";
import assert from "node:assert/strict";

import { APPLICANT_POOL_DIRECTORY, readApplicantPool } from "../../src/landlord/applicant-pool.js";
import { POOL_DATE } from "../../src/landlord/applicant-pool-generator.js";
import { buildListing } from "../../src/landlord/listing.js";
import { createLandlordContext, createLandlordOrchestrator, createLandlordTools } from "../../src/landlord/orchestrator/index.js";
import { createLandlordStore } from "../../src/landlord/store.js";
import { createOpenAIModels } from "../../src/orchestrator/openai.js";
import { createFakeBerlinWfs } from "../helpers/fake-berlin-wfs.js";

// The live landlord chat test calls the real OpenAI API with the real landlord Tools (committed
// Applicant pool, in-memory store, Berlin WFS faked). Like test/orchestrator/openai-live.test.js it
// runs only when OPENAI_API_KEY and OPENAI_MODEL are set, e.g. `node --env-file=.env --test`.
const live = Boolean(process.env.OPENAI_API_KEY?.trim() && process.env.OPENAI_MODEL?.trim());
const liveOptions = { skip: live ? false : "set OPENAI_API_KEY and OPENAI_MODEL to run", timeout: 180_000 };

async function liveLandlord() {
  const store = createLandlordStore({ path: ":memory:" });
  const { landlordId } = store.signIn("Live Test");
  const listing = await buildListing(
    { address: "Wühlischstraße 30, 10245 Berlin", livingAreaSqm: 60, rooms: 2, askingRent: 900 },
    { fetchImpl: createFakeBerlinWfs().fetchImpl },
  );
  store.saveListing(landlordId, listing);
  const pool = await readApplicantPool(APPLICANT_POOL_DIRECTORY, { today: POOL_DATE });
  const landlordState = { getStore: () => store, getApplicantPool: async () => pool };
  const orchestrator = createLandlordOrchestrator({
    model: createOpenAIModels().supervisor,
    tools: createLandlordTools(landlordState).tools,
    getContext: createLandlordContext(landlordState),
    log: () => {},
  });
  return { store, landlordId, orchestrator };
}

async function collect(stream) {
  const events = [];
  for await (const event of stream) events.push(event);
  return events;
}

const typesOf = (events) => events.map((e) => e.type);

test("live: a stated preference raises the employment weight and a Shortlist request saves the entry", liveOptions, async () => {
  const { store, landlordId, orchestrator } = await liveLandlord();

  const preference = await collect(orchestrator.send({ landlordId, message: "Stable income matters most to me." }));
  assert.equal(preference.at(-1).type, "done", JSON.stringify(preference.at(-1)));
  assert.ok(typesOf(preference).includes("criteria"), JSON.stringify(preference));
  assert.ok(store.getCriteria(landlordId).weights.employment > 15);

  const shortlist = await collect(orchestrator.send({ landlordId, message: "Put A-003 on the shortlist to invite." }));
  assert.equal(shortlist.at(-1).type, "done", JSON.stringify(shortlist.at(-1)));
  assert.ok(typesOf(shortlist).includes("shortlist"), JSON.stringify(shortlist));
  assert.deepEqual(store.getShortlist(landlordId).map(({ applicantId, status }) => ({ applicantId, status })), [{ applicantId: "A-003", status: "to_invite" }]);
});
