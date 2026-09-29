import test from "node:test";
import assert from "node:assert/strict";

import { restoredChat } from "../../public/chat/restore.js";
import { setLanguage } from "../../public/i18n.js";

const user = (text, extra = {}) => ({ role: "user", text, document: false, confirm: null, ...extra });
const answer = (text) => ({ role: "assistant", text });
const userBubble = (text, extra = {}) => ({ kind: "user", text, leaseLabel: null, confirmed: null, ...extra });

// The UI language is global: every test that sets it starts from the default again.
test.afterEach(() => setLanguage("de"));

test("a Transcript becomes the user and bot bubbles, in order", () => {
  setLanguage("en");
  const transcript = [
    user("Can you check my rent?"),
    answer("Tell me your **address**.\n\n_Not legal advice._"),
    user("A poem, please"),
    answer("I can only help with Berlin housing questions."),
    user("Hello?"),
  ];
  assert.deepEqual(restoredChat({ transcript, tenancy: {} }).bubbles, [
    userBubble("Can you check my rent?"),
    { kind: "bot", markdown: "Tell me your **address**.\n\n_Not legal advice._" },
    userBubble("A poem, please"),
    { kind: "bot", markdown: "I can only help with Berlin housing questions." },
    userBubble("Hello?"),
  ]);
});

test("an empty Transcript draws nothing", () => {
  assert.deepEqual(restoredChat({ transcript: [], tenancy: {} }), { bubbles: [], review: null });
});

test("entries with nothing to show or of an unknown shape are skipped", () => {
  assert.deepEqual(
    restoredChat({
      transcript: [
        user(""),
        answer(""),
        { role: "system", text: "internal" },
        { role: "user", text: 42 },
        answer("Hi."),
      ],
      tenancy: {},
    }).bubbles,
    [{ kind: "bot", markdown: "Hi." }],
  );
});

test("a lease upload shows the lease chip, with or without a message", () => {
  setLanguage("en");
  const { bubbles } = restoredChat({
    transcript: [user("", { document: true }), answer("Read it."), user("Here is my lease", { document: true })],
    tenancy: {},
  });
  assert.deepEqual(bubbles, [
    userBubble("", { leaseLabel: "Lease uploaded" }),
    { kind: "bot", markdown: "Read it." },
    userBubble("Here is my lease", { leaseLabel: "Lease uploaded" }),
  ]);
});

test("confirmed values are summed up with the fact labels and units, like the live confirm bubble", () => {
  setLanguage("en");
  const { bubbles } = restoredChat({
    transcript: [
      user("", { confirm: { contractRent: "780,50", livingAreaSqm: "50" } }),
      user("It is lower", { confirm: { rooms: "2" } }),
    ],
    tenancy: {},
  });
  assert.deepEqual(bubbles, [
    userBubble("", {
      confirmed: "Values confirmed – Nettokaltmiete (net cold rent): 780,50 € / month, Living area: 50 m²",
    }),
    userBubble("It is lower", { confirmed: "Values confirmed – Rooms: 2" }),
  ]);
});

test("confirmed values the card cannot have sent (unknown facts, nested values) are left out of the summary", () => {
  setLanguage("en");
  const { bubbles } = restoredChat({
    transcript: [
      user("", { confirm: { bathroomRating: "positive", rooms: { value: 2 } } }),
      user("", { confirm: { bathroomRating: "positive", rooms: 2 } }),
    ],
    tenancy: {},
  });
  assert.deepEqual(bubbles, [userBubble("", { confirmed: "Values confirmed – Rooms: 2" })]);
});

test("the page's own labels follow the current UI language; answers stay as written", () => {
  setLanguage("de");
  const { bubbles } = restoredChat({
    transcript: [
      user("", { document: true }),
      answer("Read it."),
      user("", { confirm: { contractRent: "780,50" } }),
    ],
    tenancy: {},
  });
  assert.deepEqual(bubbles, [
    userBubble("", { leaseLabel: "Mietvertrag hochgeladen" }),
    { kind: "bot", markdown: "Read it." },
    userBubble("", { confirmed: "Werte bestätigt – Nettokaltmiete: 780,50 € / Monat" }),
  ]);
});

const unconfirmedRent = {
  contractRent: { value: 30000, source: "lease", confidence: 0.5 },
  rooms: { value: 2, source: "lease", confidence: 0.95 },
};

test("the review card comes back when the Tenancy still has Unconfirmed facts", () => {
  setLanguage("en");
  const transcript = [user("", { document: true }), answer("Is 30000 € right?")];
  const { review } = restoredChat({ transcript, tenancy: unconfirmedRent });
  assert.deepEqual(
    review.fields.map(({ name, label, value, unconfirmed }) => ({ name, label, value, unconfirmed })),
    [
      { name: "contractRent", label: "Nettokaltmiete (net cold rent)", value: "30000", unconfirmed: true },
      { name: "rooms", label: "Rooms", value: "2", unconfirmed: false },
    ],
  );
});

test("no review card when every lease value is confirmed, or when there is no answer to put it under", () => {
  const transcript = [user("", { document: true }), answer("Is 30000 € right?")];
  const confirmed = {
    contractRent: { value: 780.5, source: "user" },
    rooms: { value: 2, source: "lease", confidence: 0.95 },
  };
  assert.equal(restoredChat({ transcript, tenancy: confirmed }).review, null);
  assert.equal(restoredChat({ transcript: [], tenancy: unconfirmedRent }).review, null);
  assert.equal(restoredChat({ transcript: [user("", { document: true })], tenancy: unconfirmedRent }).review, null);
});
