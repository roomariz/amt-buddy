import test from "node:test";
import assert from "node:assert/strict";

import { LANDLORD_TOOL_CONTRACTS } from "../../src/landlord/orchestrator/tool-contracts.js";
import { ShortlistInputError, UnknownApplicantError, updateShortlist } from "../../src/landlord/shortlist.js";
import { createLandlordStore } from "../../src/landlord/store.js";

const APPLICANT_IDS = new Set(["A-001", "A-002", "A-003"]);

function setup() {
  const store = createLandlordStore({ path: ":memory:" });
  const { landlordId } = store.signIn("Erika Muster");
  const update = (args) => updateShortlist({ store, landlordId, applicantIds: APPLICANT_IDS, ...args });
  return { store, landlordId, update };
}

test("adding an applicant puts them on the Shortlist with their status and note", () => {
  const { store, landlordId, update } = setup();

  const result = update({ applicantId: "A-002", status: "to_invite", note: "Stable income" });

  assert.deepEqual(result, { applicantId: "A-002", status: "to_invite", note: "Stable income" });
  assert.deepEqual(
    store.getShortlist(landlordId).map(({ applicantId, status, note }) => ({ applicantId, status, note })),
    [{ applicantId: "A-002", status: "to_invite", note: "Stable income" }],
  );
});

test("a note is optional; without one the entry's note is null", () => {
  const { update } = setup();

  assert.deepEqual(update({ applicantId: "A-001", status: "invited" }), { applicantId: "A-001", status: "invited", note: null });
});

test("changing the status keeps the note unless a new one is given; null or blank clears it", () => {
  const { update } = setup();
  update({ applicantId: "A-001", status: "to_invite", note: "Call on Monday" });

  assert.equal(update({ applicantId: "A-001", status: "invited" }).note, "Call on Monday");
  assert.equal(update({ applicantId: "A-001", status: "invited", note: "  Viewing Tuesday " }).note, "Viewing Tuesday");
  assert.equal(update({ applicantId: "A-001", status: "invited", note: "   " }).note, null);
  update({ applicantId: "A-001", status: "invited", note: "again" });
  assert.equal(update({ applicantId: "A-001", status: "declined", note: null }).note, null);
});

test("the Shortlist keeps the order entries were added in, whatever is changed later", async () => {
  const { store, landlordId, update } = setup();
  // Apart in time, so ordering by the last change instead would show.
  const later = () => new Promise((resolve) => setTimeout(resolve, 5));
  update({ applicantId: "A-003", status: "to_invite" });
  await later();
  update({ applicantId: "A-001", status: "to_invite" });
  await later();
  update({ applicantId: "A-003", status: "declined" });

  assert.deepEqual(store.getShortlist(landlordId).map(({ applicantId }) => applicantId), ["A-003", "A-001"]);
});

test("status 'remove' takes the applicant off the Shortlist and reports 'removed'", () => {
  const { store, landlordId, update } = setup();
  update({ applicantId: "A-001", status: "to_invite", note: "x" });

  assert.deepEqual(update({ applicantId: "A-001", status: "remove" }), { applicantId: "A-001", status: "removed", note: null });
  assert.deepEqual(store.getShortlist(landlordId), []);
  // Removing someone who is not on the Shortlist changes nothing and is not an error.
  assert.deepEqual(update({ applicantId: "A-002", status: "remove" }), { applicantId: "A-002", status: "removed", note: null });
});

test("an invalid status, or a note over 500 characters, is an input error and saves nothing", () => {
  const { store, landlordId, update } = setup();

  for (const args of [
    { applicantId: "A-001", status: "maybe" },
    { applicantId: "A-001" },
    { applicantId: "A-001", status: "to_invite", note: "x".repeat(501) },
    { applicantId: "A-001", status: "to_invite", note: 42 },
  ]) {
    assert.throws(() => update(args), ShortlistInputError, JSON.stringify(args));
  }
  assert.deepEqual(store.getShortlist(landlordId), []);
});

test("an applicant who is not in the pool is an UnknownApplicantError, also when removing", () => {
  const { store, landlordId, update } = setup();

  assert.throws(() => update({ applicantId: "A-999", status: "to_invite" }), UnknownApplicantError);
  assert.throws(() => update({ applicantId: "A-999", status: "remove" }), UnknownApplicantError);
  assert.deepEqual(store.getShortlist(landlordId), []);
});

test("each landlord has their own Shortlist", () => {
  const { store, landlordId, update } = setup();
  const other = store.signIn("Max Muster").landlordId;
  update({ applicantId: "A-001", status: "to_invite" });

  assert.deepEqual(store.getShortlist(other), []);
  assert.equal(store.getShortlist(landlordId).length, 1);
});

test("every result satisfies the update_shortlist Tool contract's output schema", () => {
  const { update } = setup();
  const { output } = LANDLORD_TOOL_CONTRACTS.update_shortlist;

  for (const args of [
    { applicantId: "A-001", status: "to_invite", note: "n" },
    { applicantId: "A-001", status: "invited" },
    { applicantId: "A-001", status: "remove" },
  ]) {
    output.parse(update(args));
  }
});

test("an entry whose applicant has left the pool can still be changed and removed; a new one cannot be added", () => {
  const { store, landlordId, update } = setup();
  update({ applicantId: "A-003", status: "to_invite", note: "keep" });
  const smallerPool = new Set(["A-001"]);
  const later = (args) => updateShortlist({ store, landlordId, applicantIds: smallerPool, ...args });

  assert.deepEqual(later({ applicantId: "A-003", status: "invited" }), { applicantId: "A-003", status: "invited", note: "keep" });
  assert.deepEqual(later({ applicantId: "A-003", status: "remove" }), { applicantId: "A-003", status: "removed", note: null });
  assert.throws(() => later({ applicantId: "A-003", status: "to_invite" }), UnknownApplicantError);
  assert.deepEqual(store.getShortlist(landlordId), []);
});

test("the note limit counts the trimmed note", () => {
  const { update } = setup();
  const note = "x".repeat(500);

  assert.equal(update({ applicantId: "A-001", status: "to_invite", note: `  ${note}\n\n` }).note, note);
  assert.throws(() => update({ applicantId: "A-001", status: "to_invite", note: ` ${note}x ` }), ShortlistInputError);
});
