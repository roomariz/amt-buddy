// The landlord's thumbs up / down and bonus points (Round 2, decision 6): the store's ratings and
// bonus points, and the operations every caller (HTTP, chat Tool) goes through.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { adjustBonusPoints, BonusInputError, RatingInputError, updateRating } from "../../src/landlord/ratings.js";
import { UnknownApplicantError } from "../../src/landlord/shortlist.js";
import { createLandlordStore } from "../../src/landlord/store.js";

function setup() {
  const store = createLandlordStore({ path: ":memory:" });
  const { landlordId } = store.signIn("Erika Muster");
  return { store, landlordId };
}

test("store: ratings are saved per landlord and applicant, replaced, removed, and read as a Map", () => {
  const { store, landlordId } = setup();
  const other = store.signIn("Max Muster").landlordId;

  assert.deepEqual(store.getRatings(landlordId), new Map());
  store.setRating(landlordId, "A-001", 1);
  store.setRating(landlordId, "A-002", -1);
  store.setRating(other, "A-001", -1);
  assert.deepEqual(store.getRatings(landlordId), new Map([["A-001", 1], ["A-002", -1]]));

  store.setRating(landlordId, "A-001", -1);
  store.removeRating(landlordId, "A-002");
  store.removeRating(landlordId, "A-009");
  assert.deepEqual(store.getRatings(landlordId), new Map([["A-001", -1]]));
  assert.deepEqual(store.getRatings(other), new Map([["A-001", -1]]), "another landlord's ratings are their own");
});

test("store: a rating other than 1 or -1 is refused by the database", () => {
  const { store, landlordId } = setup();
  for (const rating of [0, 2, 5]) assert.throws(() => store.setRating(landlordId, "A-001", rating), String(rating));
  assert.deepEqual(store.getRatings(landlordId), new Map());
});

test("store: the bonus points are 5 until saved, per landlord", () => {
  const { store, landlordId } = setup();
  const other = store.signIn("Max Muster").landlordId;

  assert.equal(store.getBonusPoints(landlordId), 5);
  store.saveBonusPoints(landlordId, 8.5);
  store.saveBonusPoints(landlordId, 12);
  assert.equal(store.getBonusPoints(landlordId), 12);
  store.saveBonusPoints(landlordId, 0);
  assert.equal(store.getBonusPoints(landlordId), 0, "0 is a saved value, not a missing one");
  assert.equal(store.getBonusPoints(other), 5);
});

test("store: ratings and bonus points survive re-opening the database file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "amt-buddy-ratings-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "landlord.sqlite");

  const first = createLandlordStore({ path });
  const { landlordId } = first.signIn("Erika Muster");
  first.setRating(landlordId, "A-003", 1);
  first.saveBonusPoints(landlordId, 7);
  first.close();

  const second = createLandlordStore({ path });
  t.after(() => second.close());
  assert.deepEqual(second.getRatings(landlordId), new Map([["A-003", 1]]));
  assert.equal(second.getBonusPoints(landlordId), 7);
});

const POOL = new Set(["A-001", "A-002"]);

test("updateRating: up and down save 1 and -1, remove takes the rating off; each answers with the rating's name", () => {
  const { store, landlordId } = setup();
  const rate = (applicantId, rating) => updateRating({ store, landlordId, applicantIds: POOL, applicantId, rating });

  assert.deepEqual(rate("A-001", "up"), { applicantId: "A-001", rating: "up" });
  assert.deepEqual(rate("A-002", "down"), { applicantId: "A-002", rating: "down" });
  assert.deepEqual(store.getRatings(landlordId), new Map([["A-001", 1], ["A-002", -1]]));

  assert.deepEqual(rate("A-001", "remove"), { applicantId: "A-001", rating: null });
  assert.deepEqual(rate("A-001", "remove"), { applicantId: "A-001", rating: null }, "removing twice changes nothing");
  assert.deepEqual(store.getRatings(landlordId), new Map([["A-002", -1]]));
});

test("updateRating: an invalid rating is refused, nothing saved", () => {
  const { store, landlordId } = setup();
  for (const rating of [undefined, null, 1, "thumbs", "UP"]) {
    assert.throws(
      () => updateRating({ store, landlordId, applicantIds: POOL, applicantId: "A-001", rating }),
      (error) => error instanceof RatingInputError && error.details[0].field === "rating",
      String(rating),
    );
  }
  assert.deepEqual(store.getRatings(landlordId), new Map());
});

test("updateRating: an applicant outside the pool is unknown, unless a rating of theirs is being removed", () => {
  const { store, landlordId } = setup();
  const rate = (applicantId, rating, applicantIds = POOL) => updateRating({ store, landlordId, applicantIds, applicantId, rating });

  assert.throws(() => rate("A-999", "up"), UnknownApplicantError);
  assert.throws(() => rate("A-999", "remove"), UnknownApplicantError);
  assert.deepEqual(store.getRatings(landlordId), new Map());
  // A-002 rated, then gone from the pool: the rating can still be taken off, not changed.
  rate("A-002", "down");
  const smallerPool = new Set(["A-001"]);
  assert.throws(() => rate("A-002", "up", smallerPool), UnknownApplicantError);
  assert.deepEqual(rate("A-002", "remove", smallerPool), { applicantId: "A-002", rating: null });
  assert.deepEqual(store.getRatings(landlordId), new Map());
});

test("adjustBonusPoints: by factor multiplies the saved points, by points sets them; saved and reported", () => {
  const { store, landlordId } = setup();
  const adjust = (by, value) => adjustBonusPoints({ store, landlordId, by, value });

  // 5 × 1.3 = 6.5; 6.5 × 0.7 = 4.55 → 4.6 (one decimal).
  assert.deepEqual(adjust("factor", 1.3), { previous: 5, bonusPoints: 6.5, requested: 6.5, capped: false });
  assert.deepEqual(adjust("factor", 0.7), { previous: 6.5, bonusPoints: 4.6, requested: 4.6, capped: false });
  assert.deepEqual(adjust("points", 10), { previous: 4.6, bonusPoints: 10, requested: 10, capped: false });
  assert.deepEqual(adjust("factor", 0), { previous: 10, bonusPoints: 0, requested: 0, capped: false });
  assert.equal(store.getBonusPoints(landlordId), 0);
});

test("adjustBonusPoints: above 20 points is capped at 20 and reported as capped", () => {
  const { store, landlordId } = setup();

  assert.deepEqual(adjustBonusPoints({ store, landlordId, by: "factor", value: 5 }), { previous: 5, bonusPoints: 20, requested: 25, capped: true });
  assert.deepEqual(adjustBonusPoints({ store, landlordId, by: "points", value: 20 }), { previous: 20, bonusPoints: 20, requested: 20, capped: false });
  assert.deepEqual(adjustBonusPoints({ store, landlordId, by: "points", value: 30 }), { previous: 20, bonusPoints: 20, requested: 30, capped: true });
  assert.equal(store.getBonusPoints(landlordId), 20);
});

test("adjustBonusPoints: a negative value, another kind of change or a value that is not a number is refused, nothing saved", () => {
  const { store, landlordId } = setup();
  const refused = [
    ["points", -1], ["factor", -0.5], ["share", 2], [undefined, 2], ["points", "7"], ["points", Number.NaN], ["factor", Infinity], ["points", null],
  ];
  for (const [by, value] of refused) {
    assert.throws(() => adjustBonusPoints({ store, landlordId, by, value }), (error) => error instanceof BonusInputError && error.kind === "input", `${by} ${value}`);
  }
  assert.equal(store.getBonusPoints(landlordId), 5);
});

test("adjustBonusPoints rounds what is .x5 on paper up, whatever the floating-point product", () => {
  const { store, landlordId } = setup();

  // 8.5 × 0.7 = 5.95 → 6; 3 × 0.35 = 1.05 → 1.1.
  adjustBonusPoints({ store, landlordId, by: "points", value: 8.5 });
  assert.equal(adjustBonusPoints({ store, landlordId, by: "factor", value: 0.7 }).bonusPoints, 6);
  adjustBonusPoints({ store, landlordId, by: "points", value: 3 });
  assert.equal(adjustBonusPoints({ store, landlordId, by: "factor", value: 0.35 }).bonusPoints, 1.1);
});
